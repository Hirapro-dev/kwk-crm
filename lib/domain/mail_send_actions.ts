'use server';

/**
 * メール送信(返信・新規)の Server Actions。CLAUDE.md §5.15 M2 /「送信の承認・送信予約」(migration 124)。
 *
 * 2026-10-15 から、送信ボタンではすぐに送らず「承認待ち」(mail_outbox)にする(対象は全メール)。
 * 承認者(admin / manager)が承認したときに送る。送信日時を指定すると、承認後その日時に送る(送信予約)。
 * 承認・差し戻し・取消・修正は mail_outbox_actions.ts。実際の送信は lib/mail/outbox_deliver.ts。
 *
 * - From は受信箱(mail_boxes)の公開アドレス。送れるのは SES でドメイン検証済みの受信箱だけ(未検証は「受信専用」)
 * - 返信は直近の受信メールの差出人へ。In-Reply-To / References は申請時に決めて保存する
 * - 送信元はスレッドの受信箱が既定。フォームで送信可能な別の受信箱を選ぶこともできる(スレッドの受信箱は変えない)
 * - 署名・引用はフォーム側で本文に含めて送る(画面で見えるもの = 送るもの)。ここでは付け足さない
 * - 権限: viewer は不可。本文・アドレスはログに出さない(§12.4)
 */

import { getCurrentUser } from '@/lib/domain/auth';
import { getMailThread } from '@/lib/domain/mail';
import {
  MAX_RECIPIENTS,
  buildReplyHeaders,
  buildReplySubject,
  parseAddressList,
  sanitizeDisplayName,
} from '@/lib/domain/mail_compose';
import { parseScheduledInput, submittedMessage } from '@/lib/domain/mail_outbox';
import { getMailAwsConfig } from '@/lib/mail/aws';
import { domainOf, isDomainSendable } from '@/lib/mail/ses_send';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export interface SendResult {
  error?: string;
  /** 作成した送信待ちメール(mail_outbox.id) */
  outboxId?: string;
  /** 画面に出す案内文 */
  message?: string;
}

/** 本文の上限(誤って巨大なテキストを送らないための安全弁) */
const MAX_BODY_CHARS = 50_000;

function validateBody(body: string): string | null {
  const b = body ?? '';
  if (!b.trim()) return '本文を入力してください';
  if (b.length > MAX_BODY_CHARS)
    return `本文が長すぎます(${MAX_BODY_CHARS.toLocaleString()} 文字まで)`;
  return null;
}

interface BoxRow {
  id: number;
  address: string;
  display_name: string | null;
  is_active: boolean;
}

/** 送信元の受信箱を確認する(有効で、SES でドメイン検証済み) */
async function loadSendableBox(boxId: number): Promise<{ box?: BoxRow; error?: string }> {
  const cfg = getMailAwsConfig();
  if (!cfg) return { error: '送信基盤(SES)が未設定です' };
  const supabase = await createClient();
  const { data } = await supabase
    .from('mail_boxes')
    .select('id, address, display_name, is_active')
    .eq('id', boxId)
    .maybeSingle();
  const box = data as BoxRow | null;
  if (!box || !box.is_active) return { error: '送信元の受信箱が見つからないか無効です' };
  const domain = domainOf(box.address);
  if (!domain || !(await isDomainSendable(cfg, domain))) {
    return { error: `${box.address} のドメインは SES で未検証のため送信できません(受信専用)` };
  }
  return { box };
}

/** スレッドへの返信を承認待ちにする */
export async function replyToMailThread(input: {
  threadId: string;
  body: string;
  cc?: string;
  /** 差出人表示名の上書き。未指定(undefined)なら送信元受信箱の既定値を使う */
  fromName?: string;
  /** 送信元の受信箱。未指定ならスレッドの受信箱 */
  mailBoxId?: number;
  /** 送信予約(日本時間 "YYYY-MM-DDTHH:mm")。空なら承認したらすぐ送る */
  scheduledAt?: string;
}): Promise<SendResult> {
  const me = await getCurrentUser();
  if (me.role === 'viewer') return { error: '閲覧専用ユーザーは送信できません' };

  const bodyErr = validateBody(input.body);
  if (bodyErr) return { error: bodyErr };
  const schedule = parseScheduledInput(input.scheduledAt, new Date());
  if (schedule.error) return { error: schedule.error };

  const thread = await getMailThread(input.threadId);
  if (!thread) return { error: 'スレッドが見つかりません' };

  const { box, error: boxErr } = await loadSendableBox(input.mailBoxId ?? thread.mail_box_id);
  if (!box) return { error: boxErr };

  // 返信先 = 直近の受信メールの差出人。無ければ直近のメッセージ
  const inbound = [...thread.messages].reverse().find((m) => m.direction === 'in');
  const parent = inbound ?? thread.messages[thread.messages.length - 1];
  if (!parent) return { error: '返信対象のメールがありません' };
  const to = inbound ? [inbound.from_address] : parent.to_addresses;
  if (to.length === 0) return { error: '返信先アドレスが特定できません' };

  const cc = parseAddressList(input.cc);
  if (cc.error) return { error: cc.error };
  if (to.length + cc.addresses.length > MAX_RECIPIENTS) {
    return { error: `宛先が多すぎます(${MAX_RECIPIENTS} 件まで)` };
  }

  const headers = buildReplyHeaders(parent);
  const fromName =
    input.fromName !== undefined ? sanitizeDisplayName(input.fromName) : box.display_name;

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from('mail_outbox')
    .insert({
      kind: 'reply',
      thread_id: thread.id,
      mail_box_id: box.id,
      from_name: fromName,
      to_addresses: to,
      cc_addresses: cc.addresses,
      subject: buildReplySubject(thread.subject ?? parent.subject),
      text_body: `${input.body.replace(/\s+$/, '')}\n`,
      in_reply_to: headers.inReplyTo,
      references_header: headers.references,
      scheduled_at: schedule.at,
      status: 'pending',
      created_by: me.id,
    })
    .select('id')
    .single();
  if (error || !data) return { error: `承認依頼の保存に失敗しました: ${error?.message ?? ''}` };

  revalidatePath('/mail', 'layout');
  return { outboxId: (data as { id: string }).id, message: submittedMessage(schedule.at) };
}

/** 新規メールを承認待ちにする(スレッドは送信したときに作る) */
export async function createMailThreadAndSend(input: {
  mailBoxId: number;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  /** 差出人表示名の上書き。未指定(undefined)なら受信箱の既定値を使う */
  fromName?: string;
  /** 送信予約(日本時間 "YYYY-MM-DDTHH:mm")。空なら承認したらすぐ送る */
  scheduledAt?: string;
}): Promise<SendResult> {
  const me = await getCurrentUser();
  if (me.role === 'viewer') return { error: '閲覧専用ユーザーは送信できません' };

  const subject = (input.subject ?? '').replace(/\s+/g, ' ').trim();
  if (!subject) return { error: '件名を入力してください' };
  const bodyErr = validateBody(input.body);
  if (bodyErr) return { error: bodyErr };
  const schedule = parseScheduledInput(input.scheduledAt, new Date());
  if (schedule.error) return { error: schedule.error };

  const to = parseAddressList(input.to);
  if (to.error) return { error: to.error };
  if (to.addresses.length === 0) return { error: '宛先を入力してください' };
  const cc = parseAddressList(input.cc);
  if (cc.error) return { error: cc.error };
  if (to.addresses.length + cc.addresses.length > MAX_RECIPIENTS) {
    return { error: `宛先が多すぎます(${MAX_RECIPIENTS} 件まで)` };
  }

  const { box, error: boxErr } = await loadSendableBox(input.mailBoxId);
  if (!box) return { error: boxErr };
  const fromName =
    input.fromName !== undefined ? sanitizeDisplayName(input.fromName) : box.display_name;

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from('mail_outbox')
    .insert({
      kind: 'new',
      thread_id: null,
      mail_box_id: box.id,
      from_name: fromName,
      to_addresses: to.addresses,
      cc_addresses: cc.addresses,
      subject,
      text_body: `${input.body.replace(/\s+$/, '')}\n`,
      scheduled_at: schedule.at,
      status: 'pending',
      created_by: me.id,
    })
    .select('id')
    .single();
  if (error || !data) return { error: `承認依頼の保存に失敗しました: ${error?.message ?? ''}` };

  revalidatePath('/mail', 'layout');
  return { outboxId: (data as { id: string }).id, message: submittedMessage(schedule.at) };
}
