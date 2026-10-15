/**
 * 送信待ちメール(mail_outbox。migration 124)の参照。CLAUDE.md §5.15。
 * 画面からの参照は実行ユーザーのクライアント(RLS: SELECT は全ロール)。
 * テーブル未適用でも画面は壊さない(空・0 件扱い)。
 */

import { createClient } from '@/lib/supabase/server';
import type { MailOutboxKind, MailOutboxStatus } from './mail_outbox';

export interface MailOutboxItem {
  id: string;
  kind: MailOutboxKind;
  thread_id: string | null;
  mail_box_id: number;
  from_name: string | null;
  to_addresses: string[];
  cc_addresses: string[];
  subject: string;
  text_body: string;
  scheduled_at: string | null;
  status: MailOutboxStatus;
  created_by: string;
  approved_at: string | null;
  rejected_at: string | null;
  reject_reason: string | null;
  cancelled_at: string | null;
  sent_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  mail_box: { id: number; address: string; display_name: string | null } | null;
  creator: { id: string; full_name: string | null } | null;
  approver: { id: string; full_name: string | null } | null;
  rejecter: { id: string; full_name: string | null } | null;
  canceller: { id: string; full_name: string | null } | null;
}

const OUTBOX_SELECT = `
  id, kind, thread_id, mail_box_id, from_name, to_addresses, cc_addresses, subject, text_body,
  scheduled_at, status, created_by, approved_at, rejected_at, reject_reason, cancelled_at,
  sent_at, last_error, created_at, updated_at,
  mail_box:mail_boxes!mail_outbox_mail_box_id_fkey(id, address, display_name),
  creator:users!mail_outbox_created_by_fkey(id, full_name),
  approver:users!mail_outbox_approved_by_fkey(id, full_name),
  rejecter:users!mail_outbox_rejected_by_fkey(id, full_name),
  canceller:users!mail_outbox_cancelled_by_fkey(id, full_name)
`;

/** 状態で絞った一覧(新しい順)。予約中は送信予定の早い順 */
export async function listMailOutbox(
  statuses: readonly MailOutboxStatus[],
  limit = 200,
): Promise<MailOutboxItem[]> {
  const supabase = await createClient();
  let q = supabase
    .from('mail_outbox')
    .select(OUTBOX_SELECT)
    .in('status', [...statuses]);
  q = statuses.includes('approved')
    ? q.order('scheduled_at', { ascending: true, nullsFirst: true })
    : q.order('created_at', { ascending: false });
  const { data, error } = await q.limit(limit);
  if (error) return [];
  return (data ?? []) as unknown as MailOutboxItem[];
}

/** 状態ごとの件数(タブ・左フォルダの件数) */
export async function countMailOutboxByStatus(): Promise<
  Partial<Record<MailOutboxStatus, number>>
> {
  const supabase = await createClient();
  const statuses: MailOutboxStatus[] = ['pending', 'rejected', 'approved', 'sending', 'failed'];
  const results = await Promise.all(
    statuses.map((s) =>
      supabase.from('mail_outbox').select('id', { count: 'exact', head: true }).eq('status', s),
    ),
  );
  const out: Partial<Record<MailOutboxStatus, number>> = {};
  statuses.forEach((s, i) => {
    out[s] = results[i]?.error ? 0 : (results[i]?.count ?? 0);
  });
  return out;
}

export async function getMailOutbox(id: string): Promise<MailOutboxItem | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('mail_outbox')
    .select(OUTBOX_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as MailOutboxItem;
}

/** スレッドの送信待ち(まだ送っていない返信)。スレッド画面に出す */
export async function listThreadOutbox(threadId: string): Promise<MailOutboxItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('mail_outbox')
    .select(OUTBOX_SELECT)
    .eq('thread_id', threadId)
    .in('status', ['pending', 'rejected', 'approved', 'sending', 'failed'])
    .order('created_at', { ascending: true });
  if (error) return [];
  return (data ?? []) as unknown as MailOutboxItem[];
}
