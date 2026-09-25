/**
 * 記事反応リスト(article_reactions)ドメインロジック (CLAUDE.md §5.13相当)
 *
 * 会員のメルマガ等への反応(クリック等)を一覧・会員詳細で参照する。
 * 取込は lib/domain/import_article_reactions.ts(admin/サービスロール)側で行う。
 */

import { createClient } from '@/lib/supabase/server';

export interface ArticleReactionRow {
  id: string;
  reacted_date: string | null;
  media: string | null;
  tool: string | null;
  reaction_type: string | null;
  form_name: string | null;
  member_name: string | null;
  member_legacy_sf_id: string | null;
  member_id: string | null;
  detail: string | null;
  /** クリック履歴 CSV の取込分(migration 117)。Salesforce 形式の行は null */
  email: string | null;
  registered_at: string | null;
  remarks: string | null;
}

const COLS =
  'id,reacted_date,media,tool,reaction_type,form_name,member_name,member_legacy_sf_id,member_id,detail,email,registered_at,remarks';

/** 一覧でソート可能なカラム(SortHeader からの ?sort= を受ける) */
const SORTABLE = new Set([
  'id',
  'reacted_date',
  'member_id',
  'member_name',
  'media',
  'tool',
  'reaction_type',
  'form_name',
  'detail',
  'email',
  'registered_at',
  'remarks',
]);

export interface ArticleReactionListParams {
  q?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface ArticleReactionListResult {
  rows: ArticleReactionRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listArticleReactions(
  params: ArticleReactionListParams = {},
): Promise<ArticleReactionListResult> {
  const supabase = await createClient();
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, params.pageSize ?? 100));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('article_reactions')
    .select(COLS, { count: 'exact' })
    .is('deleted_at', null);

  if (params.sort && SORTABLE.has(params.sort)) {
    query = query.order(params.sort, { ascending: params.dir !== 'desc', nullsFirst: false });
  }
  // 既定は反応日の新しい順
  query = query.order('reacted_date', { ascending: false, nullsFirst: false }).range(from, to);

  if (params.q?.trim()) {
    const q = params.q.trim().replace(/[%_]/g, '\\$&');
    query = query.or(
      `id.ilike.%${q}%,member_id.ilike.%${q}%,member_name.ilike.%${q}%,detail.ilike.%${q}%,email.ilike.%${q}%,remarks.ilike.%${q}%`,
    );
  }

  const { data, error, count } = await query;
  if (error) throw new Error(`記事反応リスト取得に失敗: ${error.message}`);
  return { rows: (data ?? []) as ArticleReactionRow[], total: count ?? 0, page, pageSize };
}

/** 会員詳細ページ用: 指定会員の反応を新しい順で返す(失敗時は空配列で画面を壊さない) */
export async function getReactionsByMember(
  memberId: string,
  limit = 100,
): Promise<ArticleReactionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('article_reactions')
    .select(COLS)
    .eq('member_id', memberId)
    .is('deleted_at', null)
    .order('reacted_date', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as ArticleReactionRow[];
}

/**
 * 配信媒体の選択肢(既存の記事反応に入っている値を重複なしで返す。クリック履歴 CSV の取込画面用)。
 * 失敗時は空配列で画面を壊さない。
 */
export async function listArticleReactionMedia(): Promise<string[]> {
  const supabase = await createClient();
  // DISTINCT は PostgREST で書けないため、レポート実行用の RPC(SELECT のみ・RLS 適用)で取る。
  // 以前は先頭 1,000 行だけを読んでいたため、media の並びで後ろに来る「仮想通貨長者」が候補に出なかった(2026-09-25 修正)
  const { data, error } = await supabase.rpc('exec_report_sql', {
    query_sql:
      'SELECT DISTINCT media FROM public.article_reactions WHERE deleted_at IS NULL AND media IS NOT NULL ORDER BY media',
    query_params: [],
  });
  const set = new Set<string>(ARTICLE_REACTION_MEDIA_DEFAULTS);
  if (!error && Array.isArray(data)) {
    for (const r of data as Array<{ media: string | null }>) {
      if (r.media?.trim()) set.add(r.media.trim());
    }
  }
  return [...set].sort();
}

/** 配信媒体の既定の選択肢(DB に 1 件も無くても出す。Salesforce の配信媒体) */
export const ARTICLE_REACTION_MEDIA_DEFAULTS = [
  'KAWARA版一般会員',
  'KAWARA版正会員',
  '仮想通貨長者',
];
