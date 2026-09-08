'use server';

/**
 * メール送信(返信・新規)の Server Actions。CLAUDE.md §5.15 M2。
 *
 * - 送信は SES。From は受信箱(mail_boxes)の公開アドレス
 * - 送信できるのは SES でドメイン検証済みの受信箱だけ(未検証は「受信専用」)
 * - 返信は直近の受信メールの差出人へ。In-Reply-To / References を付けて顧客側でもスレッド化
 * - 送信後は mail_messages(direction=out)に保存し、スレッドを「対応中」にする
 * - 権限: viewer は不可(RLS と二重)。本文・アドレスはログに出さない(§12.4)
 */

import { getCurrentUser } from '@/lib/domain/auth';
import { getMailThread } from '@/lib/domain/mail';
import {
  MAX_RECIPIENTS,
  appendSignature,
  buildReplyHeaders,
  buildReplySubject,
  parseAddressList,
  sesMessageIdHeader,
} from '@/lib/domain/mail_compose';
import { getMailAwsConfig } from '@/lib/mail/aws';
import { describeSesError, domainOf, isDomainSendable, sendViaSes } from '@/lib/mail/ses_send';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export interface SendResult {
  error?: string;
  /** 送信後のスレッドID(新規作成時はここへ遷移する) */
  threadId?: string;
}

/** 本文の上限(誤って巨大なテキストを送らないための安全弁) */
const MAX_BODY_CHARS = 50_000;

async function findMemberIdByEmail(
  supabase: Awaited<ReturnType<typeof createClient>>,
  address: string,
): Promise<string | null> {
  const a = address.trim().toLowerCase();
  if (!a || /[,()%*"'\\]/.test(a)) return null;
  const escaped = a.replace(/[%_]/g, '\\$&');
  const { data } = await supabase
    .from('members')
    .select('id')
    .is('deleted_at', null)
    .or(`email1.ilike.${escaped},email2.ilike.${escaped},email3.ilike.${escaped}`)
    .order('id', { ascending: true })
    .limit(1);
  return ((data ?? []) as Array<{ id: string }>)[0]?.id ?? null;
}

function validateBody(body: string): string | null {
  const b = body ?? '';
  if (!b.trim()) return '本文を入力してください';
  if (b.length > MAX_BODY_CHARS)
    return `本文が長すぎます(${MAX_BODY_CHARS.toLocaleString()} 文字まで)`;
  return null;
}

/** スレッドに返信する */
export async function replyToMailThread(input: {
  threadId: string;
  body: string;
  cc?: string;
}): Promise<SendResult> {
  const me = await getCurrentUser();
  if (me.role === 'viewer') return { error: '閲覧専用ユーザーは送信できません' };

  const bodyErr = validateBody(input.body);
  if (bodyErr) return { error: bodyErr };

  const cfg = getMailAwsConfig();
  if (!cfg) return { error: '送信基盤(SES)が未設定です' };

  const thread = await getMailThread(input.threadId);
  if (!thread) return { error: 'スレッドが見つかりません' };
  const box = thread.mail_box;
  if (!box || !box.is_active) return { error: 'この受信箱は無効です' };

  const domain = domainOf(box.address);
  if (!domain || !(await isDomainSendable(cfg, domain))) {
    return { error: `${box.address} のドメインは SES で未検証のため送信できません(受信専用)` };
  }

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

  const subject = buildReplySubject(thread.subject ?? parent.subject);
  const headers = buildReplyHeaders(parent);
  const text = appendSignature(input.body, box.signature);

  let sesMessageId: string;
  try {
    sesMessageId = await sendViaSes(cfg, {
      fromAddress: box.address,
      fromName: box.display_name,
      to,
      cc: cc.addresses,
      subject,
      text,
      headers: { 'In-Reply-To': headers.inReplyTo, References: headers.references },
    });
  } catch (e) {
    return { error: describeSesError(e) };
  }

  const supabase = await createClient();
  const now = new Date().toISOString();
  const { error: mErr } = await supabase.from('mail_messages').insert({
    thread_id: thread.id,
    direction: 'out',
    message_id: sesMessageIdHeader(sesMessageId, cfg.region),
    in_reply_to: headers.inReplyTo,
    references_header: headers.references,
    from_address: box.address,
    from_name: box.display_name,
    to_addresses: to,
    cc_addresses: cc.addresses,
    subject,
    text_body: text,
    html_body: null,
    sent_at: now,
    provider_message_id: sesMessageId,
    delivery_status: 'queued',
    sender_user_id: me.id,
    source: 'ses',
  });
  if (mErr) {
    // 送信自体は成功している。履歴が残らなかったことを利用者に伝える
    return { error: `送信は完了しましたが履歴の保存に失敗しました: ${mErr.message}` };
  }
  await supabase
    .from('mail_threads')
    .update({ status: '対応中', last_direction: 'out', last_message_at: now, is_read: true })
    .eq('id', thread.id);

  revalidatePath('/mail');
  revalidatePath(`/mail/${thread.id}`);
  return { threadId: thread.id };
}

/** 新規スレッドを作って送信する */
export async function createMailThreadAndSend(input: {
  mailBoxId: number;
  to: string;
  cc?: string;
  subject: string;
  body: string;
}): Promise<SendResult> {
  const me = await getCurrentUser();
  if (me.role === 'viewer') return { error: '閲覧専用ユーザーは送信できません' };

  const subject = (input.subject ?? '').replace(/\s+/g, ' ').trim();
  if (!subject) return { error: '件名を入力してください' };
  const bodyErr = validateBody(input.body);
  if (bodyErr) return { error: bodyErr };

  const to = parseAddressList(input.to);
  if (to.error) return { error: to.error };
  if (to.addresses.length === 0) return { error: '宛先を入力してください' };
  const cc = parseAddressList(input.cc);
  if (cc.error) return { error: cc.error };
  if (to.addresses.length + cc.addresses.length > MAX_RECIPIENTS) {
    return { error: `宛先が多すぎます(${MAX_RECIPIENTS} 件まで)` };
  }

  const cfg = getMailAwsConfig();
  if (!cfg) return { error: '送信基盤(SES)が未設定です' };

  const supabase = await createClient();
  const { data: boxRow } = await supabase
    .from('mail_boxes')
    .select('id, address, display_name, signature, is_active')
    .eq('id', input.mailBoxId)
    .maybeSingle();
  const box = boxRow as {
    id: number;
    address: string;
    display_name: string | null;
    signature: string | null;
    is_active: boolean;
  } | null;
  if (!box || !box.is_active) return { error: '受信箱が見つからないか無効です' };

  const domain = domainOf(box.address);
  if (!domain || !(await isDomainSendable(cfg, domain))) {
    return { error: `${box.address} のドメインは SES で未検証のため送信できません(受信専用)` };
  }

  const text = appendSignature(input.body, box.signature);
  let sesMessageId: string;
  try {
    sesMessageId = await sendViaSes(cfg, {
      fromAddress: box.address,
      fromName: box.display_name,
      to: to.addresses,
      cc: cc.addresses,
      subject,
      text,
    });
  } catch (e) {
    return { error: describeSesError(e) };
  }

  const now = new Date().toISOString();
  const memberId = await findMemberIdByEmail(supabase, to.addresses[0] ?? '');
  const { data: created, error: tErr } = await supabase
    .from('mail_threads')
    .insert({
      mail_box_id: box.id,
      subject,
      member_id: memberId,
      status: '対応中',
      category: '通常',
      assignee_id: me.id,
      last_message_at: now,
      last_direction: 'out',
      is_read: true,
    })
    .select('id')
    .single();
  if (tErr || !created) {
    return { error: `送信は完了しましたが履歴の保存に失敗しました: ${tErr?.message ?? ''}` };
  }
  const threadId = (created as { id: string }).id;

  const { error: mErr } = await supabase.from('mail_messages').insert({
    thread_id: threadId,
    direction: 'out',
    message_id: sesMessageIdHeader(sesMessageId, cfg.region),
    from_address: box.address,
    from_name: box.display_name,
    to_addresses: to.addresses,
    cc_addresses: cc.addresses,
    subject,
    text_body: text,
    html_body: null,
    sent_at: now,
    provider_message_id: sesMessageId,
    delivery_status: 'queued',
    sender_user_id: me.id,
    source: 'ses',
  });
  if (mErr) {
    return { error: `送信は完了しましたが履歴の保存に失敗しました: ${mErr.message}`, threadId };
  }

  revalidatePath('/mail');
  return { threadId };
}
