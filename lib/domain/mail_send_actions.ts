'use server';

/**
 * メール送信(返信・新規)の Server Actions。CLAUDE.md §5.15 M2 /「送信の承認・送信予約」(migration 124)。
 *
 * 2026-10-15 から、送信ボタンではすぐに送らず「承認待ち」(mail_outbox)にする(対象は全メール)。
 * 承認者(admin / manager)が承認したときに送る。送信日時を指定すると、承認後その日時に送る(送信予約)。
 * 2026-10-16: 承認者本人は「承認を依頼する」か「そのまま送信する」(sendMode = 'direct')を選べる。
 * そのまま送信は承認済み(承認者 = 本人)として保存し、予約が無ければその場で送る(予約は定期実行が送る)。
 * 承認・差し戻し・取消・修正は mail_outbox_actions.ts。実際の送信は lib/mail/outbox_deliver.ts。
 *
 * - From は受信箱(mail_boxes)の公開アドレス。送れるのは SES でドメイン検証済みの受信箱だけ(未検証は「受信専用」)
 * - 返信は直近の受信メールの差出人へ。In-Reply-To / References は申請時に決めて保存する
 * - 送信元はスレッドの受信箱が既定。フォームで送信可能な別の受信箱を選ぶこともできる(スレッドの受信箱は変えない)
 * - 署名・引用はフォーム側で本文に含めて送る(画面で見えるもの = 送るもの)。ここでは付け足さない
 * - 添付(PDF・JPG・PNG・Word・Excel・PowerPoint。migration 128 / 131)は画面から Storage へ直接アップロードしたものを、ここで確かめて送信待ちメールに登録する
 *   (lib/mail/outbox_attachments.ts)。本文中の画像は本文の目印「[画像: 名前]」の位置に出す
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
import {
  type MailSendMode,
  directSentMessage,
  isDueNow,
  parseScheduledInput,
  resolveSendMode,
  submittedMessage,
} from '@/lib/domain/mail_outbox';
import type { SubmittedAttachment } from '@/lib/domain/mail_outgoing_attachments';
import { getMailAwsConfig } from '@/lib/mail/aws';
import { insertOutboxAttachments, prepareOutboxAttachments } from '@/lib/mail/outbox_attachments';
import { deliverOutboxItem } from '@/lib/mail/outbox_deliver';
import { syncThreadStatusWithOutbox } from '@/lib/mail/outbox_thread_status';
import { domainOf, isDomainSendable } from '@/lib/mail/ses_send';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export interface SendResult {
  error?: string;
  /** 作成した送信待ちメール(mail_outbox.id) */
  outboxId?: string;
  /** そのまま送信して送れたときのスレッド(新規メールは送信時に作られる) */
  threadId?: string | null;
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

/** 保存時の状態: 承認依頼は承認待ち、そのまま送信は本人が承認した扱い(承認済み) */
function statusFields(mode: MailSendMode, userId: string) {
  return mode === 'direct'
    ? { status: 'approved', approved_by: userId, approved_at: new Date().toISOString() }
    : { status: 'pending' };
}

/** 保存の後始末。そのまま送信で予約が無ければその場で送る(予約ありは定期実行が送る) */
async function finishSubmission(
  outboxId: string,
  mode: MailSendMode,
  scheduledAt: string | null,
): Promise<SendResult> {
  revalidatePath('/mail', 'layout');
  if (mode === 'approval') return { outboxId, message: submittedMessage(scheduledAt) };
  if (!isDueNow(scheduledAt, new Date()))
    return { outboxId, message: directSentMessage(scheduledAt) };
  const cfg = getMailAwsConfig();
  if (!cfg) return { outboxId, error: '送信基盤(SES)が未設定です(送信待ちに残っています)' };
  const r = await deliverOutboxItem(createServiceRoleClient(), cfg, outboxId);
  if (!r.ok)
    return {
      outboxId,
      error: `送信に失敗しました: ${r.error ?? ''}(送信待ちの「送信失敗」に残っています)`,
    };
  if (r.threadId) revalidatePath(`/mail/${r.threadId}`);
  return { outboxId, threadId: r.threadId, message: directSentMessage(null) };
}

/** 送信待ちメールに添付を登録する。失敗したらその送信待ちメールは取り消す(添付が欠けたまま承認・送信されないように) */
async function attachOrCancel(
  admin: ReturnType<typeof createServiceRoleClient>,
  outboxId: string,
  userId: string,
  rows: Parameters<typeof insertOutboxAttachments>[3],
): Promise<string | null> {
  const err = await insertOutboxAttachments(admin, outboxId, userId, rows);
  if (!err) return null;
  await admin
    .from('mail_outbox')
    .update({
      status: 'cancelled',
      cancelled_by: userId,
      cancelled_at: new Date().toISOString(),
      last_error: `添付の登録に失敗したため取り消しました: ${err}`.slice(0, 1000),
    })
    .eq('id', outboxId);
  return `添付の登録に失敗しました: ${err}`;
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
  /** 送信方法。'direct'(そのまま送信)は承認者だけ。省略時は承認を依頼 */
  sendMode?: MailSendMode;
  /** 添付(画面から Storage へアップロード済みのもの) */
  attachments?: SubmittedAttachment[];
}): Promise<SendResult> {
  const me = await getCurrentUser();
  if (me.role === 'viewer') return { error: '閲覧専用ユーザーは送信できません' };

  const bodyErr = validateBody(input.body);
  if (bodyErr) return { error: bodyErr };
  const schedule = parseScheduledInput(input.scheduledAt, new Date());
  if (schedule.error) return { error: schedule.error };
  const send = resolveSendMode(input.sendMode, me.role);
  if (send.error) return { error: send.error };

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
  const att = await prepareOutboxAttachments(admin, me.id, input.attachments);
  if (!att.rows) return { error: att.error };
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
      ...statusFields(send.mode, me.id),
      created_by: me.id,
    })
    .select('id')
    .single();
  if (error || !data) return { error: `承認依頼の保存に失敗しました: ${error?.message ?? ''}` };
  const outboxId = (data as { id: string }).id;
  const attErr = await attachOrCancel(admin, outboxId, me.id, att.rows);
  if (attErr) return { error: attErr };
  // 承認待ちの間はスレッドを「承認待ち」にする(一覧の「対応中」タブに出る。migration 129)
  await syncThreadStatusWithOutbox(admin, thread.id);

  return finishSubmission(outboxId, send.mode, schedule.at);
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
  /** 送信方法。'direct'(そのまま送信)は承認者だけ。省略時は承認を依頼 */
  sendMode?: MailSendMode;
  /** 添付(画面から Storage へアップロード済みのもの) */
  attachments?: SubmittedAttachment[];
}): Promise<SendResult> {
  const me = await getCurrentUser();
  if (me.role === 'viewer') return { error: '閲覧専用ユーザーは送信できません' };

  const subject = (input.subject ?? '').replace(/\s+/g, ' ').trim();
  if (!subject) return { error: '件名を入力してください' };
  const bodyErr = validateBody(input.body);
  if (bodyErr) return { error: bodyErr };
  const schedule = parseScheduledInput(input.scheduledAt, new Date());
  if (schedule.error) return { error: schedule.error };
  const send = resolveSendMode(input.sendMode, me.role);
  if (send.error) return { error: send.error };

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
  const att = await prepareOutboxAttachments(admin, me.id, input.attachments);
  if (!att.rows) return { error: att.error };
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
      ...statusFields(send.mode, me.id),
      created_by: me.id,
    })
    .select('id')
    .single();
  if (error || !data) return { error: `承認依頼の保存に失敗しました: ${error?.message ?? ''}` };
  const outboxId = (data as { id: string }).id;
  const attErr = await attachOrCancel(admin, outboxId, me.id, att.rows);
  if (attErr) return { error: attErr };

  return finishSubmission(outboxId, send.mode, schedule.at);
}
