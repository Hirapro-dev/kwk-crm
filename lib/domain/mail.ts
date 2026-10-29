/**
 * メール一元管理(CLAUDE.md §5.15)の参照層。
 * 受信箱(mail_boxes) / スレッド(mail_threads) / メッセージ(mail_messages) / 添付(mail_attachments)。
 *
 * - 画面からの参照は実行ユーザーのクライアント(RLS 適用)。
 * - 添付の実体は非公開バケットにあるため、閲覧用の署名 URL はサービスロールで発行する。
 * - 型・定数は mail_types.ts(クライアントからも参照できるようサーバー依存なし)。
 */

import { attachmentCountsByThread } from '@/lib/domain/mail_attachment_view';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { cache } from 'react';
import type { MailBoxCount, MailUserFolder } from './mail_folders';
import { type MailImportRule, findMatchingRule } from './mail_import_rules';
import {
  MAIL_SEARCH_LIMIT,
  type MailSearchHit,
  adjacentInHits,
  filterMailSearchHits,
  mailSearchNote,
  parseMailSearch,
} from './mail_search';
import {
  type MailThreadCountGroup,
  canCountFromGroups,
  countBoxIds,
  countFromGroups,
} from './mail_thread_counts';
import {
  MAIL_STATUSES,
  type MailBox,
  type MailMessage,
  type MailSignature,
  type MailThreadDetail,
  type MailThreadListItem,
  type MailThreadListParams,
  type MailThreadListResult,
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
    .select('id, address, display_name, default_signature_id, is_active')
    .order('id', { ascending: true });
  if (error) {
    // migration 76 未適用でも画面を壊さない(既存テーブルと同じフォールバック方針)
    return [];
  }
  return (data ?? []) as unknown as MailBox[];
}

/**
 * 署名マスタ(migration 105)。無効化済みも含めて id 順に返す(設定画面用)。
 * フォームで選べるのは有効なものだけ(呼び出し側で絞る)。テーブル未適用なら空配列。
 */
export async function listMailSignatures(): Promise<MailSignature[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('mail_signatures')
    .select('id, name, body, is_active, created_at, updated_at')
    .order('id', { ascending: true });
  if (error) return [];
  return (data ?? []) as unknown as MailSignature[];
}

/**
 * 受信箱ごとの件数(未対応 / 未読。通常分類のみ)。メーラー左ペインのフォルダ表示用。
 * migration 77 の mail_box_counts() を1回呼ぶ(受信箱が数百件でも1クエリ)。2026-10-29 から関数の中身は件数表(migration 136)を読む。
 * 関数未適用(migration 77 前)のときは空配列を返し、件数なしで画面を出す。
 */
export async function listMailBoxCounts(): Promise<MailBoxCount[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('mail_box_counts');
  if (error) return [];
  return (data ?? []) as unknown as MailBoxCount[];
}

export type ThreadFilterParams = Omit<MailThreadListParams, 'page' | 'pageSize'>;

/** 一覧と件数で同じ絞り込みを使うための共通部分 */
// biome-ignore lint/suspicious/noExplicitAny: PostgREST ビルダーの型はメソッドチェーンで変わるため
function applyThreadFilters<Q extends Record<string, any>>(
  query: Q,
  params: ThreadFilterParams,
): Q {
  let q = query;
  if (Array.isArray(params.status)) {
    // 決められた状態だけを使う(一覧の続き読み込みは画面から値が来るため)
    q = q.in(
      'status',
      params.status.filter((s) => (MAIL_STATUSES as readonly string[]).includes(s)),
    );
  } else if (params.status) q = q.eq('status', params.status);
  if (params.category) q = q.eq('category', params.category);
  if (params.assigneeId === 'none') q = q.is('assignee_id', null);
  else if (params.assigneeId) q = q.eq('assignee_id', params.assigneeId);
  if (params.mailBoxId) q = q.eq('mail_box_id', params.mailBoxId);
  // 空配列なら何も一致しない(全受信箱をマイフォルダに入れた人の「その他」は空になる)
  if (params.mailBoxIds) q = q.in('mail_box_id', params.mailBoxIds);
  if (params.unreadOnly) q = q.eq('is_read', false);
  if (params.memberId) q = q.eq('member_id', params.memberId);
  if (params.importCandidate) q = q.eq('is_import_candidate', true);
  // 検索語(q)はここでは扱わない(searchHits で一致スレッドを先に求める。migration 125)
  return q;
}

/**
 * 検索語に一致するスレッド(新しい順、最大 MAIL_SEARCH_LIMIT 件)。migration 125 の search_mail_threads。
 * 1 回の画面表示で一覧・タブ件数・前後移動が同じ検索を何度も呼ぶため、リクエスト内で結果を使い回す(React の cache)。
 */
const searchHits = cache(
  async (q: string): Promise<{ hits: MailSearchHit[]; note: string; error?: string }> => {
    const parsed = parseMailSearch(q);
    if (!parsed) return { hits: [], note: '' };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('search_mail_threads', {
      p_mode: parsed.mode,
      p_query: parsed.term,
      p_limit: MAIL_SEARCH_LIMIT,
    });
    if (error) {
      const timeout = /statement timeout|canceling statement/i.test(error.message);
      return {
        hits: [],
        note: '',
        error: timeout
          ? '検索に時間がかかりすぎたため中断しました。言葉を足して絞り込んでください'
          : `検索に失敗しました: ${error.message}`,
      };
    }
    const hits = (data ?? []) as MailSearchHit[];
    return { hits, note: mailSearchNote(parsed, hits.length) };
  },
);

/** 検索語があるときの一致スレッドに、一覧と同じ絞り込みをかける */
async function filteredSearchHits(params: ThreadFilterParams) {
  const r = await searchHits((params.q ?? '').trim());
  return { ...r, hits: filterMailSearchHits(r.hits, params) };
}

/**
 * 件数表(migration 136)から、受信箱で絞った区分ごとの件数を読む(CLAUDE.md §5.15「件数表」)。
 * 1 回の表示で左フォルダ・タブ・一覧の総件数が何度も使うため、リクエスト内で使い回す(React の cache)。
 * boxKey は受信箱 ID のカンマ区切り('all' = 全受信箱、'' = 0 件)。読めない(未適用など)ときと、
 * 1 行も無いとき(中身を作る前。受信箱にスレッドが無いだけのこともあるが、その場で数えても軽い)は null。
 */
const threadCountGroups = cache(async (boxKey: string): Promise<MailThreadCountGroup[] | null> => {
  const supabase = await createClient();
  const boxIds = boxKey === 'all' ? null : boxKey === '' ? [] : boxKey.split(',').map(Number);
  const { data, error } = await supabase.rpc('mail_thread_count_groups', { p_box_ids: boxIds });
  if (error || !data || data.length === 0) return null;
  return data as unknown as MailThreadCountGroup[];
});

/**
 * 条件に一致するスレッド件数だけを返す(行は取得しない)。
 * メーラーの状態タブ(新着 / 対応中 / 完了 …)・左フォルダ・一覧の総件数に使う。
 * 受信箱・状態・分類・未読・取込候補だけの絞り込みは件数表から合計する(2026-10-29。表示のたびに
 * 約 117 万件を数え直していたため)。担当・会員で絞るとき、件数表が読めないときは、その場で数える。
 */
export async function countMailThreads(params: ThreadFilterParams = {}): Promise<number> {
  if (params.q?.trim()) return (await filteredSearchHits(params)).hits.length;
  if (canCountFromGroups(params)) {
    const ids = countBoxIds(params);
    const groups = await threadCountGroups(ids === null ? 'all' : ids.join(','));
    if (groups) return countFromGroups(groups, params);
  }
  const supabase = await createClient();
  const query = applyThreadFilters(
    supabase
      .from('mail_threads')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null),
    params,
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

  // 検索語があるときは、一致したスレッド(検索結果)から 1 ページ分を取り出して詳細を引く
  if (params.q?.trim()) {
    const { hits, note, error } = await filteredSearchHits(params);
    if (error && params.strict) throw new Error(error);
    const ids = hits.slice(from, to + 1).map((h) => h.id);
    if (ids.length === 0) {
      return { rows: [], total: hits.length, page, pageSize, searchNote: note, searchError: error };
    }
    const { data, error: tErr } = await supabase
      .from('mail_threads')
      .select(THREAD_SELECT)
      .in('id', ids);
    if (tErr) {
      if (params.strict) throw new Error(`メール一覧の取得に失敗しました: ${tErr.message}`);
      return { rows: [], total: 0, page, pageSize, searchError: tErr.message };
    }
    const byId = new Map(((data ?? []) as unknown as MailThreadListItem[]).map((r) => [r.id, r]));
    const rows = ids.map((id) => byId.get(id)).filter((r): r is MailThreadListItem => !!r);
    await Promise.all([
      attachLatestInbound(supabase, rows, params),
      attachAttachmentCounts(supabase, rows),
    ]);
    return { rows, total: hits.length, page, pageSize, searchNote: note };
  }

  // 総件数は初回(1ページ目)だけ数える。追加読み込みでは不要で、数十万件の候補では数え直しが重いため。
  // 件数表から数えられる条件なら、一覧と一緒に数えず件数表から出す(2026-10-29。タブの件数と同じ数)
  const fastCount = page === 1 && canCountFromGroups(params);
  const query = applyThreadFilters(
    supabase
      .from('mail_threads')
      .select(THREAD_SELECT, page === 1 && !fastCount ? { count: 'exact' } : undefined)
      .is('deleted_at', null)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .range(from, to),
    params,
  );

  const [{ data, error, count }, fastTotal] = await Promise.all([
    query,
    fastCount ? countMailThreads(params) : Promise.resolve(null),
  ]);
  if (error) {
    // 追加読み込みでは失敗を画面に伝える(空を返すと「全件表示」と誤解される)
    if (params.strict) throw new Error(`メール一覧の取得に失敗しました: ${error.message}`);
    // migration 76 未適用の場合は空で返す
    return { rows: [], total: 0, page, pageSize };
  }

  const rows = (data ?? []) as unknown as MailThreadListItem[];
  await Promise.all([
    attachLatestInbound(supabase, rows, params),
    attachAttachmentCounts(supabase, rows),
  ]);
  return { rows, total: fastTotal ?? count ?? 0, page, pageSize };
}

/**
 * 一覧の件名にクリップを出すため、各スレッドの添付ファイルの数をまとめて引いて行に付ける(2026-10-23)。
 * 添付のあるメッセージだけを内部結合で引く。電子署名などの部品は数えない(attachmentCountsByThread)。
 * 失敗しても一覧は出す(クリップが出ないだけ)。
 */
async function attachAttachmentCounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: MailThreadListItem[],
): Promise<void> {
  if (rows.length === 0) return;
  const { data, error } = await supabase
    .from('mail_messages')
    .select('thread_id, attachments:mail_attachments!inner(content_type)')
    .in(
      'thread_id',
      rows.map((r) => r.id),
    );
  if (error || !data) return;
  const counts = attachmentCountsByThread(
    data as unknown as { thread_id: string; attachments: { content_type: string | null }[] }[],
  );
  for (const r of rows) r.attachment_count = counts.get(r.id) ?? 0;
}

/** 一覧に差出人を出すため、各スレッドの最新の受信メッセージをまとめて引いて行に付ける */
async function attachLatestInbound(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: MailThreadListItem[],
  params: MailThreadListParams,
): Promise<void> {
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const { data: msgs } = await supabase
      .from('mail_messages')
      .select(
        // 取込候補のときはルールの本文キーワード判定のため本文も引く(通常の一覧では引かない)
        `thread_id, from_address, from_name, subject, sent_at, direction, import_status, import_note, inquiry_id, lp_entry_id${
          params.importCandidate ? ', text_body, html_body' : ''
        }`,
      )
      .in('thread_id', ids)
      .eq('direction', 'in')
      .order('sent_at', { ascending: false });
    // 取込候補の一覧では、各メールがどのルールに一致するかも出す(判定は純粋関数 findMatchingRule)
    const rules = params.importCandidate ? await listMailImportRules() : [];
    const seen = new Set<string>();
    for (const m of (msgs ?? []) as Array<{
      thread_id: string;
      from_address: string;
      from_name: string | null;
      subject: string | null;
      text_body?: string | null;
      html_body?: string | null;
      import_status: 'pending' | 'done' | 'error' | null;
      import_note: string | null;
      inquiry_id: string | null;
      lp_entry_id: string | null;
    }>) {
      if (seen.has(m.thread_id)) continue;
      seen.add(m.thread_id);
      const row = rows.find((r) => r.id === m.thread_id);
      if (row) {
        row.last_from_address = m.from_address;
        row.last_from_name = m.from_name;
        row.last_import_status = m.import_status ?? null;
        row.last_import_note = m.import_note ?? null;
        row.last_inquiry_id = m.inquiry_id ?? null;
        row.last_lp_entry_id = m.lp_entry_id ?? null;
        if (params.importCandidate) {
          const rule = findMatchingRule(rules, {
            mailBoxId: row.mail_box_id,
            fromAddress: m.from_address,
            subject: m.subject ?? '',
            textBody: m.text_body,
            htmlBody: m.html_body,
          });
          row.last_import_rule = rule ? { id: rule.id, name: rule.name } : null;
        }
      }
    }
  }
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
  // 検索結果から開いたときは、検索結果の並びで前後へ移る
  if (params.q?.trim()) return adjacentInHits((await filteredSearchHits(params)).hits, threadId);
  const supabase = await createClient();
  const { data: cur } = await supabase
    .from('mail_threads')
    .select('id, last_message_at')
    .eq('id', threadId)
    .maybeSingle();
  const c = cur as { id: string; last_message_at: string | null } | null;
  if (!c?.last_message_at) return { prevId: null, nextId: null };
  const at = c.last_message_at;

  const base = () =>
    applyThreadFilters(
      supabase
        .from('mail_threads')
        .select('id')
        .is('deleted_at', null)
        .not('last_message_at', 'is', null),
      params,
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
       mail_box:mail_boxes!mail_threads_mail_box_id_fkey(id, address, display_name, default_signature_id, is_active)`,
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
        import_status, import_note, inquiry_id, lp_entry_id,
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

/**
 * 自分がピン留めした受信箱の ID(ピン留めした順)。migration 84。
 * 行は RLS で実行ユーザー自身のものに限られる。テーブル未適用なら空配列(画面を壊さない)。
 */
export async function listMyMailBoxPins(): Promise<number[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('mail_box_pins')
    .select('mail_box_id, created_at')
    .order('created_at', { ascending: true });
  if (error) return [];
  // mail_box_pins は生成済みの DB 型に無いため、行の形を明示する
  const rows = (data ?? []) as unknown as Array<{ mail_box_id: number }>;
  return rows.map((r) => Number(r.mail_box_id));
}

/**
 * 自分のマイフォルダ(migration 92)。フォルダは sort_order → id 順、フォルダ内の受信箱は sort_order 順。
 * テーブル未適用なら空配列(画面を壊さない)。
 */
export async function listMyMailUserFolders(): Promise<MailUserFolder[]> {
  const supabase = await createClient();
  const [{ data: folders, error: fErr }, { data: items, error: iErr }] = await Promise.all([
    supabase
      .from('mail_user_folders')
      .select('id, name, sort_order')
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true }),
    supabase
      .from('mail_user_folder_items')
      .select('folder_id, mail_box_id, sort_order')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
  ]);
  if (fErr || iErr) return [];
  const byFolder = new Map<number, number[]>();
  for (const it of (items ?? []) as unknown as Array<{ folder_id: number; mail_box_id: number }>) {
    const list = byFolder.get(Number(it.folder_id)) ?? [];
    list.push(Number(it.mail_box_id));
    byFolder.set(Number(it.folder_id), list);
  }
  return ((folders ?? []) as unknown as Array<{ id: number; name: string }>).map((f) => ({
    id: Number(f.id),
    name: f.name,
    boxIds: byFolder.get(Number(f.id)) ?? [],
  }));
}

/**
 * メール取込ルール(§5.16 / migration 87)の一覧。判定順(sort_order → id)。
 * テーブル未適用なら空配列(画面を壊さない)。
 */
export async function listMailImportRules(): Promise<MailImportRule[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('mail_import_rules')
    .select(
      'id, name, is_active, sort_order, mail_box_id, from_address, subject_contains, body_contains, form_name_contains, target, form_name_source, form_name_param, field_map',
    )
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });
  if (error) return [];
  return (data ?? []) as unknown as MailImportRule[];
}
