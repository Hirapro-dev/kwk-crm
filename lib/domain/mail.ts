/**
 * メール一元管理(CLAUDE.md §5.15)の参照層。
 * 受信箱(mail_boxes) / スレッド(mail_threads) / メッセージ(mail_messages) / 添付(mail_attachments)。
 *
 * - 画面からの参照は実行ユーザーのクライアント(RLS 適用)。
 * - 添付の実体は非公開バケットにあるため、閲覧用の署名 URL はサービスロールで発行する。
 * - 型・定数は mail_types.ts(クライアントからも参照できるようサーバー依存なし)。
 */

import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import type {
  MailBox,
  MailMessage,
  MailThreadDetail,
  MailThreadListItem,
  MailThreadListParams,
  MailThreadListResult,
} from './mail_types';

export * from './mail_types';

const DEFAULT_PAGE_SIZE = 50;

const THREAD_SELECT = `
  id, mail_box_id, subject, member_id, status, assignee_id,
  last_message_at, last_direction, is_read, created_at, updated_at,
  member:members!mail_threads_member_id_fkey(id, name),
  assignee:users!mail_threads_assignee_id_fkey(id, full_name)
`;

export async function listMailBoxes(): Promise<MailBox[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('mail_boxes')
    .select('id, address, display_name, signature, is_active')
    .order('id', { ascending: true });
  if (error) {
    // migration 76 未適用でも画面を壊さない(既存テーブルと同じフォールバック方針)
    return [];
  }
  return (data ?? []) as unknown as MailBox[];
}

/**
 * 受信箱のスレッド一覧。最終メッセージ日時の降順。
 * 同時刻の並びを決定論的にするため id を第2キーにする(対応歴と同じ理由)。
 */
export async function listMailThreads(
  params: MailThreadListParams = {},
): Promise<MailThreadListResult> {
  const supabase = await createClient();
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, params.pageSize ?? DEFAULT_PAGE_SIZE));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('mail_threads')
    .select(THREAD_SELECT, { count: 'exact' })
    .is('deleted_at', null)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })
    .range(from, to);

  if (params.status) query = query.eq('status', params.status);
  if (params.assigneeId === 'none') query = query.is('assignee_id', null);
  else if (params.assigneeId) query = query.eq('assignee_id', params.assigneeId);
  if (params.mailBoxId) query = query.eq('mail_box_id', params.mailBoxId);
  if (params.unreadOnly) query = query.eq('is_read', false);
  if (params.memberId) query = query.eq('member_id', params.memberId);
  if (params.q?.trim()) {
    const q = params.q.trim().replace(/[%_]/g, '\\$&');
    query = query.ilike('subject', `%${q}%`);
  }

  const { data, error, count } = await query;
  if (error) {
    // migration 76 未適用の場合は空で返す
    return { rows: [], total: 0, page, pageSize };
  }

  const rows = (data ?? []) as unknown as MailThreadListItem[];

  // 一覧に差出人を出すため、各スレッドの最新の受信メッセージをまとめて引く
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const { data: msgs } = await supabase
      .from('mail_messages')
      .select('thread_id, from_address, from_name, sent_at, direction')
      .in('thread_id', ids)
      .eq('direction', 'in')
      .order('sent_at', { ascending: false });
    const seen = new Set<string>();
    for (const m of (msgs ?? []) as Array<{
      thread_id: string;
      from_address: string;
      from_name: string | null;
    }>) {
      if (seen.has(m.thread_id)) continue;
      seen.add(m.thread_id);
      const row = rows.find((r) => r.id === m.thread_id);
      if (row) {
        row.last_from_address = m.from_address;
        row.last_from_name = m.from_name;
      }
    }
  }

  return { rows, total: count ?? 0, page, pageSize };
}

/** スレッド詳細(メッセージは古い順、添付付き) */
export async function getMailThread(id: string): Promise<MailThreadDetail | null> {
  const supabase = await createClient();
  const { data: thread, error } = await supabase
    .from('mail_threads')
    .select(
      `${THREAD_SELECT},
       mail_box:mail_boxes!mail_threads_mail_box_id_fkey(id, address, display_name, signature, is_active)`,
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(`メールスレッド取得に失敗: ${error.message}`);
  if (!thread) return null;

  const { data: messages, error: mErr } = await supabase
    .from('mail_messages')
    .select(
      `
        id, thread_id, direction, message_id, in_reply_to, references_header,
        from_address, from_name, to_addresses, cc_addresses, subject,
        text_body, html_body, sent_at, provider_message_id, delivery_status,
        sender_user_id, created_at,
        sender:users!mail_messages_sender_user_id_fkey(id, full_name),
        attachments:mail_attachments(id, message_id, filename, content_type, size_bytes, storage_path)
      `,
    )
    .eq('thread_id', id)
    .order('sent_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (mErr) throw new Error(`メール取得に失敗: ${mErr.message}`);

  return {
    ...(thread as unknown as MailThreadListItem),
    mail_box: ((thread as unknown as { mail_box: MailBox | null }).mail_box ??
      null) as MailBox | null,
    messages: (messages ?? []) as unknown as MailMessage[],
  };
}

/** 会員に紐づくスレッド(会員詳細のメールタブ用。M3) */
export async function listMailThreadsByMember(memberId: string, limit = 50) {
  return listMailThreads({ memberId, page: 1, pageSize: limit });
}

/**
 * 添付の閲覧用 URL(短期署名)。バケットは非公開のためサービスロールで発行する。
 * 呼び出し側(Server Component / Route)で認証済みであることが前提。
 */
export async function getMailAttachmentSignedUrl(
  storagePath: string,
  expiresInSec = 60,
): Promise<string | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.storage
    .from('mail-attachments')
    .createSignedUrl(storagePath, expiresInSec);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
