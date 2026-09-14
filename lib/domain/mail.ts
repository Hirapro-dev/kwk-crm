/**
 * メール一元管理(CLAUDE.md §5.15)の参照層。
 * 受信箱(mail_boxes) / スレッド(mail_threads) / メッセージ(mail_messages) / 添付(mail_attachments)。
 *
 * - 画面からの参照は実行ユーザーのクライアント(RLS 適用)。
 * - 添付の実体は非公開バケットにあるため、閲覧用の署名 URL はサービスロールで発行する。
 * - 型・定数は mail_types.ts(クライアントからも参照できるようサーバー依存なし)。
 */

import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import type { MailBoxCount } from './mail_folders';
import { classifyMailSearchQuery, escapeLikeWildcards, jstDateRangeToUtcIso } from './mail_search';
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
  id, mail_box_id, subject, member_id, status, category, assignee_id,
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
 * 受信箱ごとの件数(未対応 / 未読。通常分類のみ)。メーラー左ペインのフォルダ表示用。
 * migration 77 の mail_box_counts() を1回呼ぶ(受信箱が数百件でも1クエリ)。
 * 関数未適用(migration 77 前)のときは空配列を返し、件数なしで画面を出す。
 */
export async function listMailBoxCounts(): Promise<MailBoxCount[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('mail_box_counts');
  if (error) return [];
  return (data ?? []) as unknown as MailBoxCount[];
}

export type ThreadFilterParams = Omit<MailThreadListParams, 'page' | 'pageSize'>;

/**
 * ヘッダー検索(q)の解決結果。会員IDは mail_threads.member_id への完全一致で済むが、
 * メールアドレス・キーワードは mail_messages を横断する必要があるため、
 * 先に migration 79 の RPC で対象スレッドIDを引いてから絞り込む。
 */
type ResolvedMailSearch = { kind: 'member_id'; value: string } | { kind: 'ids'; ids: string[] };

/** 一致するスレッドが無いことを表す実在しない ID(空配列での .in() の代わりに使う) */
const NO_MATCH_SENTINEL_ID = '00000000-0000-0000-0000-000000000000';

async function resolveMailSearch(
  // biome-ignore lint/suspicious/noExplicitAny: Supabase クライアントの型は生成型に依存するため
  supabase: any,
  q: string | undefined,
): Promise<ResolvedMailSearch | null> {
  const parsed = classifyMailSearchQuery(q);
  if (!parsed) return null;
  if (parsed.kind === 'member_id') return { kind: 'member_id', value: parsed.value };

  const pattern = `%${escapeLikeWildcards(parsed.value)}%`;
  const { data, error } = await supabase.rpc('search_mail_thread_ids', {
    p_pattern: pattern,
    p_kind: parsed.kind,
  });
  if (error) return { kind: 'ids', ids: [] }; // migration 79 未適用等は「一致なし」扱い
  return {
    kind: 'ids',
    ids: ((data ?? []) as Array<{ thread_id: string }>).map((r) => r.thread_id),
  };
}

/** 一覧と件数で同じ絞り込みを使うための共通部分 */
// biome-ignore lint/suspicious/noExplicitAny: PostgREST ビルダーの型はメソッドチェーンで変わるため
function applyThreadFilters<Q extends Record<string, any>>(
  query: Q,
  params: ThreadFilterParams,
  search: ResolvedMailSearch | null,
): Q {
  let q = query;
  if (params.status) q = q.eq('status', params.status);
  if (params.category) q = q.eq('category', params.category);
  if (params.assigneeId === 'none') q = q.is('assignee_id', null);
  else if (params.assigneeId) q = q.eq('assignee_id', params.assigneeId);
  if (params.mailBoxId) q = q.eq('mail_box_id', params.mailBoxId);
  if (params.unreadOnly) q = q.eq('is_read', false);
  if (params.memberId) q = q.eq('member_id', params.memberId);
  const { fromIso, toIso } = jstDateRangeToUtcIso(params.dateFrom, params.dateTo);
  if (fromIso) q = q.gte('last_message_at', fromIso);
  if (toIso) q = q.lte('last_message_at', toIso);
  if (search?.kind === 'member_id') q = q.eq('member_id', search.value);
  else if (search?.kind === 'ids') {
    q = q.in('id', search.ids.length > 0 ? search.ids : [NO_MATCH_SENTINEL_ID]);
  }
  return q;
}

/**
 * 条件に一致するスレッド件数だけを返す(行は取得しない)。
 * メーラーの状態タブ(新着 / 対応中 / 完了 …)に件数を出すために使う。
 */
export async function countMailThreads(params: ThreadFilterParams = {}): Promise<number> {
  const supabase = await createClient();
  const search = await resolveMailSearch(supabase, params.q);
  const query = applyThreadFilters(
    supabase
      .from('mail_threads')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null),
    params,
    search,
  );
  const { count, error } = await query;
  if (error) return 0;
  return count ?? 0;
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

  const search = await resolveMailSearch(supabase, params.q);
  const query = applyThreadFilters(
    supabase
      .from('mail_threads')
      .select(THREAD_SELECT, { count: 'exact' })
      .is('deleted_at', null)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .range(from, to),
    params,
    search,
  );

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

/**
 * 一覧の並び(last_message_at desc, id desc)で、指定スレッドの前(新しい側)と次(古い側)を返す。
 * 絞り込み条件は一覧と同じものを渡す(タブ・受信箱・担当・未読・件名)。
 * スレッド画面の「← 前のメール / 次のメール →」用。last_message_at が無いスレッドは対象外。
 */
export async function getAdjacentMailThreads(
  threadId: string,
  params: ThreadFilterParams = {},
): Promise<{ prevId: string | null; nextId: string | null }> {
  const supabase = await createClient();
  const { data: cur } = await supabase
    .from('mail_threads')
    .select('id, last_message_at')
    .eq('id', threadId)
    .maybeSingle();
  const c = cur as { id: string; last_message_at: string | null } | null;
  if (!c?.last_message_at) return { prevId: null, nextId: null };
  const at = c.last_message_at;

  const search = await resolveMailSearch(supabase, params.q);
  const base = () =>
    applyThreadFilters(
      supabase
        .from('mail_threads')
        .select('id')
        .is('deleted_at', null)
        .not('last_message_at', 'is', null),
      params,
      search,
    );
  const [prev, next] = await Promise.all([
    base()
      .or(`last_message_at.gt.${at},and(last_message_at.eq.${at},id.gt.${c.id})`)
      .order('last_message_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(1),
    base()
      .or(`last_message_at.lt.${at},and(last_message_at.eq.${at},id.lt.${c.id})`)
      .order('last_message_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1),
  ]);
  const pick = (r: { data: unknown }) => ((r.data ?? []) as Array<{ id: string }>)[0]?.id ?? null;
  return { prevId: pick(prev), nextId: pick(next) };
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
        sender_user_id, source, created_at,
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
