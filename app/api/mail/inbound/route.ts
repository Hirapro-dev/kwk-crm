/**
 * SES 受信通知の Webhook(仕様書 §5.15)
 *
 * POST /api/mail/inbound  ← SNS(HTTPS サブスクリプション)から呼ばれる
 *
 * 経路: 各サーバーの転送 → 受信用アドレス → SES 受信ルール → S3(生 MIME)→ SNS → ここ
 *
 * - SubscriptionConfirmation: 署名検証のうえ SubscribeURL を叩いて購読を確定する
 * - Notification / notificationType=Received: S3 から MIME を取得して解析し、
 *   スレッド判定・会員突合・自動分類のうえ保存する。添付は Supabase Storage へ
 * - Notification / Bounce・Delivery・Complaint: 送信メールの配信状態を更新する(M2)
 *
 * 安全策:
 *   - SNS の署名を検証(署名用証明書は sns.<region>.amazonaws.com のものだけ)。不一致は 401
 *   - TopicArn が MAIL_SNS_TOPIC_ARN と一致しない通知は 403
 *   - 受信用アドレス(MAIL_INBOUND_ADDRESS)宛でない受信は無視(200 を返し再送させない)
 *   - ウイルス判定 FAIL は取り込まない。スパム判定 FAIL は「迷惑メール」として取り込む
 *   - 二重登録防止: provider_message_id(SES の messageId)と Message-ID の両方で判定
 *   - S3 取得・解析の失敗は 500 を返し SNS の再送に任せる
 *   - 本文・アドレスはログに出さない(§12.4)
 *
 * 書込はサービスロール(RLS 対象外)。ユーザーセッションは無い。
 */

import {
  classifyInbound,
  ensureMessageId,
  extractReferencedMessageIds,
  headerLinesToRecord,
  isBlockedAttachment,
  isInboundTarget,
  matchMailBox,
  normalizeSubject,
  parseAddress,
  safeFilename,
} from '@/lib/domain/mail_inbound';
import { createS3Client, getMailAwsConfig } from '@/lib/mail/aws';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { type AddressObject, type ParsedMail, simpleParser } from 'mailparser';
import { NextResponse } from 'next/server';
import MessageValidator from 'sns-validator';

/** 保存する添付の上限。これを超えるものは本文だけ取り込み、添付は保存しない。 */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const DELIVERY_STATUS_BY_TYPE: Record<string, string> = {
  Delivery: 'delivered',
  Bounce: 'bounced',
  Complaint: 'failed',
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** SNS の署名検証(コールバック API を Promise 化) */
function validateSnsMessage(message: Record<string, unknown>): Promise<boolean> {
  const validator = new MessageValidator();
  return new Promise((resolve) => {
    validator.validate(message, (err) => resolve(!err));
  });
}

/** mailparser の AddressObject(単数/配列)からアドレス文字列の配列にする */
function addressesOf(v: AddressObject | AddressObject[] | undefined): string[] {
  const list = Array.isArray(v) ? v : v ? [v] : [];
  const out: string[] = [];
  for (const a of list) {
    for (const e of a.value ?? []) {
      if (e.address) out.push(e.address);
    }
  }
  return out;
}

/** 会員突合用: PostgREST の or 句に安全に埋め込めるアドレスか(区切り記号・ワイルドカードを含まない) */
function isSafeForMatch(address: string): boolean {
  return address !== '' && !/[,()%*"'\\]/.test(address);
}

/** SES 受信通知(SNS の Message に入る JSON)のうち使う部分 */
interface SesReceivedNotification {
  notificationType: 'Received';
  mail: { messageId: string; source?: string; destination?: string[] };
  receipt: {
    recipients?: string[];
    spamVerdict?: { status?: string };
    virusVerdict?: { status?: string };
    action?: { type?: string; bucketName?: string; objectKey?: string; objectKeyPrefix?: string };
  };
}

interface SesDeliveryNotification {
  notificationType: 'Bounce' | 'Delivery' | 'Complaint';
  mail: { messageId: string };
}

export async function POST(request: Request): Promise<Response> {
  const cfg = getMailAwsConfig();
  if (!cfg) {
    return json({ error: 'mail integration is not configured' }, 503);
  }

  // SNS は Content-Type text/plain で JSON を送る
  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(await request.text()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid body' }, 400);
  }

  if (!(await validateSnsMessage(envelope))) {
    return json({ error: 'invalid signature' }, 401);
  }
  if (envelope.TopicArn !== cfg.snsTopicArn) {
    return json({ error: 'unexpected topic' }, 403);
  }

  const type = envelope.Type;

  // ---- 購読確認 ----
  if (type === 'SubscriptionConfirmation') {
    const url = String(envelope.SubscribeURL ?? '');
    if (!/^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com\//.test(url)) {
      return json({ error: 'unexpected subscribe url' }, 400);
    }
    const res = await fetch(url);
    return json({ ok: res.ok, confirmed: res.ok });
  }
  if (type !== 'Notification') {
    return json({ ok: true, ignored: String(type) });
  }

  let payload: SesReceivedNotification | SesDeliveryNotification;
  try {
    payload = JSON.parse(String(envelope.Message ?? '')) as typeof payload;
  } catch {
    return json({ error: 'invalid notification message' }, 400);
  }

  const supabase = createServiceRoleClient();

  // ---- 送信メールの配信状態(M2) ----
  const deliveryStatus = DELIVERY_STATUS_BY_TYPE[payload.notificationType];
  if (deliveryStatus) {
    const messageId = payload.mail?.messageId;
    if (messageId) {
      await supabase
        .from('mail_messages')
        .update({ delivery_status: deliveryStatus })
        .eq('provider_message_id', messageId)
        .eq('direction', 'out');
    }
    return json({ ok: true, type: payload.notificationType });
  }
  if (payload.notificationType !== 'Received') {
    return json({ ok: true, ignored: payload.notificationType });
  }

  const { mail, receipt } = payload;

  // ---- 受信用アドレス宛の受信だけを取り込む(他所からの流入は無視) ----
  if (!isInboundTarget(receipt.recipients ?? [], cfg.inboundAddress)) {
    return json({ ok: true, ignored: 'not addressed to inbound address' });
  }
  // ---- ウイルス判定 FAIL は取り込まない ----
  if (receipt.virusVerdict?.status === 'FAIL') {
    return json({ ok: true, ignored: 'virus verdict failed' });
  }

  // ---- 二重登録防止(1): SES の messageId で既に取り込み済みか ----
  const { data: dupByProvider } = await supabase
    .from('mail_messages')
    .select('id')
    .eq('provider_message_id', mail.messageId)
    .maybeSingle();
  if (dupByProvider) {
    return json({ ok: true, duplicate: true });
  }

  // ---- S3 から生 MIME を取得して解析 ----
  const bucket = receipt.action?.bucketName || cfg.inboundBucket;
  const key =
    receipt.action?.objectKey || `${receipt.action?.objectKeyPrefix ?? ''}${mail.messageId}`;
  let parsed: ParsedMail;
  try {
    const s3 = createS3Client(cfg);
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bytes = await obj.Body?.transformToByteArray();
    if (!bytes) throw new Error('empty object');
    parsed = await simpleParser(Buffer.from(bytes));
  } catch {
    // S3 の一時障害等。500 で SNS の再送に任せる
    return json({ error: 'failed to fetch or parse email' }, 500);
  }

  const headers = headerLinesToRecord(parsed.headerLines);
  const fromEntry = parsed.from?.value?.[0];
  const from = fromEntry?.address
    ? { address: fromEntry.address.toLowerCase(), name: fromEntry.name || null }
    : parseAddress(parsed.from?.text ?? mail.source ?? '');
  const messageId = ensureMessageId(parsed.messageId);
  const inReplyTo = headers['in-reply-to'] ?? null;
  const references = headers.references ?? null;
  const sentAt =
    parsed.date && !Number.isNaN(parsed.date.getTime())
      ? parsed.date.toISOString()
      : new Date().toISOString();
  const toAddresses = addressesOf(parsed.to);
  const ccAddresses = addressesOf(parsed.cc);

  // ---- 受信箱の特定: 元の宛先(To / Cc / 転送で付くヘッダ)と mail_boxes.address の一致 ----
  const { data: boxes } = await supabase
    .from('mail_boxes')
    .select('id, address, is_active')
    .eq('is_active', true);
  const box = matchMailBox(
    (boxes ?? []) as Array<{ id: number; address: string; is_active: boolean }>,
    [
      ...toAddresses,
      ...ccAddresses,
      headers['delivered-to'],
      headers['x-original-to'],
      headers['xsrv-filter'],
    ],
  );
  if (!box) {
    // 受信用アドレス宛だが、どの共有アドレス宛か判定できない(未登録のアドレスなど)。
    // 再送させても結果は変わらないため 200 で受け取り、登録漏れは応答で分かるようにする
    return json({ ok: true, ignored: 'no matching mail box for original recipient' });
  }

  // ---- 二重登録防止(2): Message-ID で既に取り込み済みか ----
  const { data: dupByMessageId } = await supabase
    .from('mail_messages')
    .select('id')
    .eq('message_id', messageId)
    .maybeSingle();
  if (dupByMessageId) {
    return json({ ok: true, duplicate: true });
  }

  // ---- スレッド判定: In-Reply-To / References のいずれかが既存メッセージに一致すれば同スレッド ----
  let threadId: string | null = null;
  const refIds = extractReferencedMessageIds(inReplyTo, references);
  if (refIds.length > 0) {
    const { data: parent } = await supabase
      .from('mail_messages')
      .select('thread_id')
      .in('message_id', refIds)
      .limit(1)
      .maybeSingle();
    threadId = (parent as { thread_id: string } | null)?.thread_id ?? null;
  }

  // ---- 会員突合: 差出人アドレスと members.email1/2/3 の完全一致(大文字小文字は無視) ----
  let memberId: string | null = null;
  let memberAmbiguous = false;
  if (isSafeForMatch(from.address)) {
    const escaped = from.address.replace(/[%_]/g, '\\$&');
    const { data: candidates } = await supabase
      .from('members')
      .select('id')
      .is('deleted_at', null)
      .or(`email1.ilike.${escaped},email2.ilike.${escaped},email3.ilike.${escaped}`)
      .order('id', { ascending: true })
      .limit(2);
    const list = (candidates ?? []) as Array<{ id: string }>;
    memberId = list[0]?.id ?? null;
    memberAmbiguous = list.length > 1;
  }

  // ---- 自動分類 ----
  const category = classifyInbound({
    headers,
    fromAddress: from.address,
    subject: parsed.subject,
    sesSpamFail: receipt.spamVerdict?.status === 'FAIL',
    isKnownMember: memberId !== null,
  });

  // ---- スレッドを作成 or 更新 ----
  if (!threadId) {
    const { data: created, error: tErr } = await supabase
      .from('mail_threads')
      .insert({
        mail_box_id: box.id,
        subject: normalizeSubject(parsed.subject) || null,
        member_id: memberId,
        status: '未対応',
        category,
        last_message_at: sentAt,
        last_direction: 'in',
        is_read: false,
      })
      .select('id')
      .single();
    if (tErr || !created) {
      return json({ error: 'failed to create thread' }, 500);
    }
    threadId = (created as { id: string }).id;
  } else {
    const { data: current } = await supabase
      .from('mail_threads')
      .select('status, member_id')
      .eq('id', threadId)
      .maybeSingle();
    const cur = current as { status: string; member_id: string | null } | null;
    await supabase
      .from('mail_threads')
      .update({
        last_message_at: sentAt,
        last_direction: 'in',
        is_read: false,
        // 完了後に顧客から返信が来たら未対応に戻す(埋もれさせない)
        ...(cur?.status === '完了' ? { status: '未対応' } : {}),
        // 未紐付けのスレッドに会員が判明したら紐付ける(既存の紐付けは上書きしない)
        ...(!cur?.member_id && memberId ? { member_id: memberId } : {}),
        deleted_at: null,
      })
      .eq('id', threadId);
  }

  // ---- メッセージ保存 ----
  const { data: message, error: mErr } = await supabase
    .from('mail_messages')
    .insert({
      thread_id: threadId,
      direction: 'in',
      message_id: messageId,
      in_reply_to: inReplyTo,
      references_header: references,
      from_address: from.address || (parsed.from?.text ?? ''),
      from_name: from.name,
      to_addresses: toAddresses,
      cc_addresses: ccAddresses,
      subject: parsed.subject ?? null,
      text_body: parsed.text ?? null,
      html_body: typeof parsed.html === 'string' ? parsed.html : null,
      sent_at: sentAt,
      provider_message_id: mail.messageId,
      source: 'ses',
    })
    .select('id')
    .single();
  if (mErr || !message) {
    // 一意制約違反(同時再送)は重複として扱う
    if ((mErr as { code?: string } | null)?.code === '23505') {
      return json({ ok: true, duplicate: true });
    }
    return json({ error: 'failed to store message' }, 500);
  }
  const messageRowId = (message as { id: string }).id;

  // ---- 添付: 解析結果の Buffer をそのまま Storage へ保存 ----
  let savedAttachments = 0;
  let skippedAttachments = 0;
  for (const att of parsed.attachments ?? []) {
    const size = att.size ?? att.content?.byteLength ?? 0;
    if (isBlockedAttachment(att.filename) || size > MAX_ATTACHMENT_BYTES || !att.content) {
      skippedAttachments++;
      continue;
    }
    try {
      const filename = safeFilename(att.filename);
      const storagePath = `${threadId}/${messageRowId}/${att.checksum ?? savedAttachments}_${filename}`;
      const { error: upErr } = await supabase.storage
        .from('mail-attachments')
        .upload(storagePath, att.content, {
          contentType: att.contentType || 'application/octet-stream',
          upsert: true,
        });
      if (upErr) {
        skippedAttachments++;
        continue;
      }
      await supabase.from('mail_attachments').insert({
        message_id: messageRowId,
        filename: att.filename || filename,
        content_type: att.contentType || null,
        size_bytes: size,
        storage_path: storagePath,
      });
      savedAttachments++;
    } catch {
      // 添付1件の失敗でメール本体の取り込みを失敗扱いにはしない
      skippedAttachments++;
    }
  }

  return json({
    ok: true,
    thread_id: threadId,
    category,
    member_matched: memberId !== null,
    member_ambiguous: memberAmbiguous,
    attachments: { saved: savedAttachments, skipped: skippedAttachments },
  });
}
