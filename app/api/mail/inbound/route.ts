/**
 * Resend Webhook 受信(仕様書 §5.15)
 *
 * POST /api/mail/inbound
 *
 * - `email.received`: 受信メールを取り込む。Webhook にはメタデータしか無いため、
 *   本文・ヘッダは Resend API で取得し、添付は期限付き URL から即座に Storage へ保存する。
 * - `email.sent/delivered/bounced/failed`: 送信メールの配信状態を更新する(M2)。
 *
 * 安全策:
 *   - Resend の署名(Svix 形式)を検証。不一致は 401。
 *   - 受信用アドレス(MAIL_INBOUND_ADDRESS)宛でない受信は無視(200 を返し再送させない)。
 *     数百の共有アドレスはすべてこの1アドレスへ転送され、どの受信箱かは元の宛先
 *     (To / Cc / Delivered-To 等。転送で保持されることを実メールで確認済み)で判定する。
 *   - 二重登録防止: provider_message_id(Resend の email_id)と message_id の両方で判定。
 *   - Resend API の失敗時は 500 を返して Resend 側の再送に任せる。
 *   - 本文・アドレスはログに出さない(§12.4)。
 *
 * 書込はサービスロール(RLS 対象外)。ユーザーセッションは無い。
 */

import {
  ensureMessageId,
  extractReferencedMessageIds,
  isBlockedAttachment,
  isInboundTarget,
  matchMailBox,
  normalizeSubject,
  parseAddress,
  safeFilename,
} from '@/lib/domain/mail_inbound';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { Resend } from 'resend';

/** 保存する添付の上限。これを超えるものは本文だけ取り込み、添付は保存しない。 */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const DELIVERY_STATUS_BY_EVENT: Record<string, string> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.failed': 'failed',
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** ヘッダ名の大文字小文字を無視して取り出す */
function header(headers: Record<string, string> | null | undefined, name: string): string | null {
  if (!headers) return null;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? (headers[key] ?? null) : null;
}

/** 会員突合用: PostgREST の or 句に安全に埋め込めるアドレスか(区切り記号・ワイルドカードを含まない) */
function isSafeForMatch(address: string): boolean {
  return address !== '' && !/[,()%*"'\\]/.test(address);
}

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.RESEND_API_KEY;
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const inboundAddress = process.env.MAIL_INBOUND_ADDRESS;
  if (!apiKey || !secret || !inboundAddress) {
    return json({ error: 'mail integration is not configured' }, 503);
  }

  // 署名検証は生のリクエスト本文で行う(1文字でも変わると検証に失敗する)
  const payload = await request.text();
  const resend = new Resend(apiKey);

  let event: ReturnType<typeof resend.webhooks.verify>;
  try {
    event = resend.webhooks.verify({
      payload,
      headers: {
        id: request.headers.get('svix-id') ?? '',
        timestamp: request.headers.get('svix-timestamp') ?? '',
        signature: request.headers.get('svix-signature') ?? '',
      },
      webhookSecret: secret,
    });
  } catch {
    return json({ error: 'invalid signature' }, 401);
  }

  const supabase = createServiceRoleClient();

  // ---- 送信メールの配信状態(M2) ----
  const deliveryStatus = DELIVERY_STATUS_BY_EVENT[event.type];
  if (deliveryStatus) {
    const emailId = (event.data as { email_id?: string }).email_id;
    if (emailId) {
      await supabase
        .from('mail_messages')
        .update({ delivery_status: deliveryStatus })
        .eq('provider_message_id', emailId)
        .eq('direction', 'out');
    }
    return json({ ok: true, type: event.type });
  }

  if (event.type !== 'email.received') {
    return json({ ok: true, ignored: event.type });
  }

  const meta = event.data;

  // ---- 受信用アドレス宛の受信だけを取り込む(他所からの流入は無視) ----
  if (!isInboundTarget([...(meta.received_for ?? []), ...(meta.to ?? [])], inboundAddress)) {
    return json({ ok: true, ignored: 'not addressed to inbound address' });
  }

  // ---- 二重登録防止(1): Resend の email_id で既に取り込み済みか ----
  const { data: dupByProvider } = await supabase
    .from('mail_messages')
    .select('id')
    .eq('provider_message_id', meta.email_id)
    .maybeSingle();
  if (dupByProvider) {
    return json({ ok: true, duplicate: true });
  }

  // ---- 本文・ヘッダを取得(Webhook にはメタデータしか無い) ----
  const { data: email, error: fetchErr } = await resend.emails.receiving.get(meta.email_id);
  if (fetchErr || !email) {
    // Resend 側の一時障害の可能性があるため 500 で再送を促す
    return json({ error: 'failed to fetch received email' }, 500);
  }

  // ---- 受信箱の特定: 元の宛先(To / Cc / 転送で付くヘッダ)と mail_boxes.address の一致 ----
  const { data: boxes } = await supabase
    .from('mail_boxes')
    .select('id, address, is_active')
    .eq('is_active', true);
  const box = matchMailBox(
    (boxes ?? []) as Array<{ id: number; address: string; is_active: boolean }>,
    [
      ...(email.to ?? []),
      ...(email.cc ?? []),
      header(email.headers, 'Delivered-To'),
      header(email.headers, 'X-Original-To'),
      header(email.headers, 'XSRV-Filter'),
    ],
  );
  if (!box) {
    // 受信用アドレス宛だが、どの共有アドレス宛か判定できない(未登録のアドレスなど)。
    // 再送させても結果は変わらないため 200 で受け取り、登録漏れは応答で分かるようにする
    return json({ ok: true, ignored: 'no matching mail box for original recipient' });
  }

  const from = parseAddress(email.from);
  const messageId = ensureMessageId(email.message_id);
  const inReplyTo = header(email.headers, 'In-Reply-To');
  const references = header(email.headers, 'References');
  const dateHeader = header(email.headers, 'Date');
  const sentAt = (() => {
    const d = dateHeader ? new Date(dateHeader) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toISOString() : email.created_at;
  })();

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

  // ---- スレッドを作成 or 更新 ----
  if (!threadId) {
    const { data: created, error: tErr } = await supabase
      .from('mail_threads')
      .insert({
        mail_box_id: box.id,
        subject: normalizeSubject(email.subject) || null,
        member_id: memberId,
        status: '未対応',
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
      from_address: from.address || email.from,
      from_name: from.name,
      to_addresses: email.to ?? [],
      cc_addresses: email.cc ?? [],
      subject: email.subject ?? null,
      text_body: email.text,
      html_body: email.html,
      sent_at: sentAt,
      provider_message_id: meta.email_id,
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

  // ---- 添付: 期限付き URL は後で取れなくなるため、ここで取得して Storage に保存 ----
  let savedAttachments = 0;
  let skippedAttachments = 0;
  for (const att of email.attachments ?? []) {
    if (isBlockedAttachment(att.filename) || att.size > MAX_ATTACHMENT_BYTES) {
      skippedAttachments++;
      continue;
    }
    try {
      const { data: info, error: aErr } = await resend.emails.receiving.attachments.get({
        emailId: meta.email_id,
        id: att.id,
      });
      if (aErr || !info?.download_url) {
        skippedAttachments++;
        continue;
      }
      const res = await fetch(info.download_url);
      if (!res.ok) {
        skippedAttachments++;
        continue;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      const filename = safeFilename(att.filename);
      const storagePath = `${threadId}/${messageRowId}/${att.id}_${filename}`;
      const { error: upErr } = await supabase.storage
        .from('mail-attachments')
        .upload(storagePath, bytes, {
          contentType: att.content_type || 'application/octet-stream',
          upsert: true,
        });
      if (upErr) {
        skippedAttachments++;
        continue;
      }
      await supabase.from('mail_attachments').insert({
        message_id: messageRowId,
        filename: att.filename || filename,
        content_type: att.content_type || null,
        size_bytes: att.size ?? bytes.byteLength,
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
    member_matched: memberId !== null,
    member_ambiguous: memberAmbiguous,
    attachments: { saved: savedAttachments, skipped: skippedAttachments },
  });
}
