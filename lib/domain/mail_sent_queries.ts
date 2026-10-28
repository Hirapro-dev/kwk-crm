/**
 * メーラーの「送信済み」「自分の送信履歴」の取得(CLAUDE.md §5.15「送信済み・自分の送信履歴」)。サーバー専用。
 * 送信メール(direction = 'out')を 1 通ずつ新しい順に読む。削除したスレッドのメールは出さない。
 * 索引は migration 133(送信メールだけの (sent_at, id) と (sender_user_id, sent_at, id))。
 */

import { createClient } from '@/lib/supabase/server';

export interface SentMessageRow {
  id: string;
  thread_id: string;
  subject: string | null;
  to_addresses: string[];
  from_address: string;
  sent_at: string;
  delivery_status: string | null;
  source: string;
  sender: { full_name: string | null } | null;
}

/**
 * 送信メールを新しい順に limit 件読む。senderUserId を渡すとその人が CRM から送ったものだけ
 * (メールディーラーから取り込んだ分は送信者の記録が無いため出ない)。before は前のページの最後の行の位置。
 */
export async function listSentMessages(opts: {
  senderUserId?: string;
  before?: { sentAt: string; id: string } | null;
  limit: number;
}): Promise<{ rows: SentMessageRow[]; hasMore: boolean; error?: string }> {
  const supabase = await createClient();
  let q = supabase
    .from('mail_messages')
    .select(
      'id, thread_id, subject, to_addresses, from_address, sent_at, delivery_status, source, sender:users!mail_messages_sender_user_id_fkey(full_name), thread:mail_threads!inner(deleted_at)',
    )
    .eq('direction', 'out')
    .not('sent_at', 'is', null)
    .is('thread.deleted_at', null);
  if (opts.senderUserId) q = q.eq('sender_user_id', opts.senderUserId);
  if (opts.before) {
    // before の値は parseSentCursor で ISO 日時と UUID に限定したもの
    q = q.or(
      `sent_at.lt.${opts.before.sentAt},and(sent_at.eq.${opts.before.sentAt},id.lt.${opts.before.id})`,
    );
  }
  const { data, error } = await q
    .order('sent_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(opts.limit + 1);
  if (error) return { rows: [], hasMore: false, error: error.message };
  const rows = (data ?? []) as unknown as SentMessageRow[];
  return { rows: rows.slice(0, opts.limit), hasMore: rows.length > opts.limit };
}
