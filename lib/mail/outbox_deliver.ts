/**
 * 送信待ちメール(mail_outbox。migration 124)を実際に送る処理。サーバー専用。
 * 承認の Server Action(すぐ送るとき)と、送信予約の定期実行(app/api/cron/mail-outbox)の両方から使う。
 *
 * - 二重送信の防止: 送る前に status を approved → sending へ条件付きで書き換え、書き換えられた 1 件だけを送る
 *   (承認の操作と定期実行が同時に動いても、どちらか一方しか送らない)
 * - 送信後は mail_messages(direction=out)に保存し、スレッドを「対応中」にする(従来の即時送信と同じ)。
 *   新規メールはこの時点でスレッドを作る
 * - 書込みはサービスロール(定期実行には利用者のセッションが無いため)。送信者は作成者(created_by)として記録する
 * - 本文・アドレスはログに出さない(§12.4)
 */

import { sesMessageIdHeader } from '@/lib/domain/mail_compose';
import type { MailAwsConfig } from '@/lib/mail/aws';
import { describeSesError, domainOf, isDomainSendable, sendViaSes } from '@/lib/mail/ses_send';
import type { createServiceRoleClient } from '@/lib/supabase/server';

type AdminClient = ReturnType<typeof createServiceRoleClient>;

interface OutboxRow {
  id: string;
  kind: 'reply' | 'new';
  thread_id: string | null;
  mail_box_id: number;
  from_name: string | null;
  to_addresses: string[];
  cc_addresses: string[];
  subject: string;
  text_body: string;
  in_reply_to: string | null;
  references_header: string | null;
  created_by: string;
}

export interface DeliverResult {
  ok: boolean;
  /** 送らなかった理由(既に他で送信中など)や失敗の内容 */
  error?: string;
  threadId?: string | null;
}

async function findMemberIdByEmail(admin: AdminClient, address: string): Promise<string | null> {
  const a = address.trim().toLowerCase();
  if (!a || /[,()%*"'\\]/.test(a)) return null;
  const escaped = a.replace(/[%_]/g, '\\$&');
  const { data } = await admin
    .from('members')
    .select('id')
    .is('deleted_at', null)
    .or(`email1.ilike.${escaped},email2.ilike.${escaped},email3.ilike.${escaped}`)
    .order('id', { ascending: true })
    .limit(1);
  return ((data ?? []) as Array<{ id: string }>)[0]?.id ?? null;
}

async function markFailed(admin: AdminClient, id: string, message: string): Promise<void> {
  await admin
    .from('mail_outbox')
    .update({ status: 'failed', last_error: message.slice(0, 1000) })
    .eq('id', id)
    .eq('status', 'sending');
}

/**
 * 承認済み(approved)の 1 件を送る。
 * 状態の確認(承認済みか・予約日時を過ぎたか)は呼び出し側で行うこと。ここでは approved → sending の取得だけを条件にする。
 */
export async function deliverOutboxItem(
  admin: AdminClient,
  cfg: MailAwsConfig,
  id: string,
): Promise<DeliverResult> {
  // 1) 送信権の取得(approved のものだけ sending にできる)
  const { data: claimed, error: claimErr } = await admin
    .from('mail_outbox')
    .update({ status: 'sending', last_error: null })
    .eq('id', id)
    .eq('status', 'approved')
    .select(
      'id, kind, thread_id, mail_box_id, from_name, to_addresses, cc_addresses, subject, text_body, in_reply_to, references_header, created_by',
    );
  if (claimErr)
    return { ok: false, error: `送信待ちメールの更新に失敗しました: ${claimErr.message}` };
  const row = ((claimed ?? []) as OutboxRow[])[0];
  if (!row) return { ok: false, error: 'このメールは既に送信中か、承認済みではありません' };

  // 2) 送信元の確認(承認から送信までの間に無効化・未検証になっていないか)
  const { data: boxRow } = await admin
    .from('mail_boxes')
    .select('id, address, is_active')
    .eq('id', row.mail_box_id)
    .maybeSingle();
  const box = boxRow as { id: number; address: string; is_active: boolean } | null;
  if (!box || !box.is_active) {
    await markFailed(admin, row.id, '送信元の受信箱が見つからないか無効です');
    return { ok: false, error: '送信元の受信箱が見つからないか無効です' };
  }
  const domain = domainOf(box.address);
  if (!domain || !(await isDomainSendable(cfg, domain))) {
    const msg = `${box.address} のドメインは SES で未検証のため送信できません(受信専用)`;
    await markFailed(admin, row.id, msg);
    return { ok: false, error: msg };
  }

  // 3) 送信
  let sesMessageId: string;
  try {
    sesMessageId = await sendViaSes(cfg, {
      fromAddress: box.address,
      fromName: row.from_name,
      to: row.to_addresses,
      cc: row.cc_addresses,
      subject: row.subject,
      text: row.text_body,
      headers:
        row.kind === 'reply'
          ? { 'In-Reply-To': row.in_reply_to ?? '', References: row.references_header ?? '' }
          : undefined,
    });
  } catch (e) {
    const msg = describeSesError(e);
    await markFailed(admin, row.id, msg);
    return { ok: false, error: msg };
  }

  // 4) 履歴の保存(送信自体は完了している。ここで失敗しても再送しないよう sent にする)
  const now = new Date().toISOString();
  let threadId = row.thread_id;
  let saveError: string | null = null;

  if (row.kind === 'new' || !threadId) {
    const memberId = await findMemberIdByEmail(admin, row.to_addresses[0] ?? '');
    const { data: created, error: tErr } = await admin
      .from('mail_threads')
      .insert({
        mail_box_id: box.id,
        subject: row.subject,
        member_id: memberId,
        status: '対応中',
        category: '通常',
        assignee_id: row.created_by,
        last_message_at: now,
        last_direction: 'out',
        is_read: true,
      })
      .select('id')
      .single();
    if (tErr || !created) saveError = `スレッドの作成に失敗: ${tErr?.message ?? ''}`;
    else threadId = (created as { id: string }).id;
  }

  let messageRowId: string | null = null;
  if (threadId) {
    const { data: msg, error: mErr } = await admin
      .from('mail_messages')
      .insert({
        thread_id: threadId,
        direction: 'out',
        message_id: sesMessageIdHeader(sesMessageId, cfg.region),
        in_reply_to: row.kind === 'reply' ? row.in_reply_to : null,
        references_header: row.kind === 'reply' ? row.references_header : null,
        from_address: box.address,
        from_name: row.from_name,
        to_addresses: row.to_addresses,
        cc_addresses: row.cc_addresses,
        subject: row.subject,
        text_body: row.text_body,
        html_body: null,
        sent_at: now,
        provider_message_id: sesMessageId,
        delivery_status: 'queued',
        sender_user_id: row.created_by,
        source: 'ses',
      })
      .select('id')
      .single();
    if (mErr || !msg) saveError = `メールの保存に失敗: ${mErr?.message ?? ''}`;
    else messageRowId = (msg as { id: string }).id;

    if (row.kind === 'reply') {
      await admin
        .from('mail_threads')
        .update({ status: '対応中', last_direction: 'out', last_message_at: now, is_read: true })
        .eq('id', threadId);
    }
  }

  await admin
    .from('mail_outbox')
    .update({
      status: 'sent',
      sent_at: now,
      thread_id: threadId,
      sent_message_id: messageRowId,
      last_error: saveError ? `送信は完了しましたが履歴の保存に失敗しました: ${saveError}` : null,
    })
    .eq('id', row.id);

  return { ok: true, threadId };
}

/**
 * 承認済みで送る時刻になったものを送る(定期実行)。1 回の上限件数まで。
 * 予約なし(scheduled_at が NULL)の承認済みも拾う: 通常は承認の操作でその場で送るが、
 * そこで送れずに承認済みのまま残った場合(送信基盤の未設定・処理の中断など)の取りこぼしを防ぐ。
 */
export async function deliverDueOutbox(
  admin: AdminClient,
  cfg: MailAwsConfig,
  now: Date,
  limit = 20,
): Promise<{ sent: number; failed: number }> {
  const { data, error } = await admin
    .from('mail_outbox')
    .select('id')
    .eq('status', 'approved')
    .or(`scheduled_at.is.null,scheduled_at.lte.${now.toISOString()}`)
    .order('scheduled_at', { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw new Error(`送信予約の取得に失敗: ${error.message}`);
  let sent = 0;
  let failed = 0;
  for (const r of (data ?? []) as Array<{ id: string }>) {
    const res = await deliverOutboxItem(admin, cfg, r.id);
    if (res.ok) sent++;
    else failed++;
  }
  return { sent, failed };
}
