/**
 * LP(lp_entries)ドメインロジック(CLAUDE.md §5.17)。
 * LP・メルマガ登録系フォームの問合せ(Salesforce 由来)を問合せとは別のオブジェクトとして参照する。
 * 一覧・詳細・会員詳細の関連の参照のみ。取込は scripts/import/import_lp_entries.ts(サービスロール)。
 */

import { createClient } from '@/lib/supabase/server';

export interface LpEntryRow {
  id: string;
  member_id: string | null;
  registered_month: string | null;
  form_name: string | null;
  ad_id: string | null;
  email: string | null;
  name: string | null;
  name_kana: string | null;
  registered_at: string | null;
  created_at: string;
  updated_at: string;
  member?: { id: string; name: string } | null;
}

const LP_COLS =
  'id,member_id,registered_month,form_name,ad_id,email,name,name_kana,registered_at,created_at,updated_at,member:members!lp_entries_member_id_fkey(id,name)';

/** 一覧でソート可能なカラム */
const LP_SORTABLE = new Set([
  'id',
  'registered_at',
  'form_name',
  'email',
  'name',
  'member_id',
  'ad_id',
  'registered_month',
]);

export interface LpListParams {
  /** 問合せID / メール / 氏名 / 氏名かな / 会員ID の部分一致 */
  q?: string;
  /** フォーム名(完全一致) */
  formName?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface LpListResult {
  rows: LpEntryRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listLpEntries(params: LpListParams = {}): Promise<LpListResult> {
  const supabase = await createClient();
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, params.pageSize ?? 50));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('lp_entries')
    .select(LP_COLS, { count: 'exact' })
    .is('deleted_at', null);
  if (params.formName) query = query.eq('form_name', params.formName);
  if (params.q?.trim()) {
    const q = params.q.trim().replace(/[%_]/g, '\\$&');
    query = query.or(
      `id.ilike.%${q}%,email.ilike.%${q}%,name.ilike.%${q}%,name_kana.ilike.%${q}%,member_id.ilike.%${q}%`,
    );
  }
  if (params.sort && LP_SORTABLE.has(params.sort)) {
    query = query.order(params.sort, { ascending: params.dir !== 'desc', nullsFirst: false });
  } else {
    // 既定は登録日時の新しい順(インデックス idx_lp_entries_registered と同じ並び)
    query = query.order('registered_at', { ascending: false, nullsFirst: false });
  }
  query = query.order('id', { ascending: false }).range(from, to);

  const { data, error, count } = await query;
  if (error) {
    // migration 95 未適用でも画面を壊さない
    return { rows: [], total: 0, page, pageSize };
  }
  return { rows: (data ?? []) as unknown as LpEntryRow[], total: count ?? 0, page, pageSize };
}

export async function getLpEntry(id: string): Promise<LpEntryRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('lp_entries')
    .select(LP_COLS)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as LpEntryRow;
}

/** 会員詳細の関連「LP登録」用(新しい順) */
export async function listLpEntriesByMember(memberId: string, limit = 100): Promise<LpEntryRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('lp_entries')
    .select(LP_COLS)
    .eq('member_id', memberId)
    .is('deleted_at', null)
    .order('registered_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as unknown as LpEntryRow[];
}

/** フォーム名の一覧(絞り込み用。件数の多い順に最大 100 種類) */
export async function listLpFormNames(): Promise<string[]> {
  const supabase = await createClient();
  // 集計 RPC は持たないため、直近 5000 件から重複排除する簡易版
  const { data, error } = await supabase
    .from('lp_entries')
    .select('form_name')
    .is('deleted_at', null)
    .not('form_name', 'is', null)
    .order('registered_at', { ascending: false, nullsFirst: false })
    .limit(5000);
  if (error) return [];
  const counts = new Map<string, number>();
  for (const r of (data ?? []) as Array<{ form_name: string }>) {
    counts.set(r.form_name, (counts.get(r.form_name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 100)
    .map(([k]) => k);
}
