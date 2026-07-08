/**
 * 出金管理-親/子 (withdrawal_parents / withdrawal_children) ドメインロジック
 * (CLAUDE.md §5.13)
 *
 * 一覧・詳細の参照。RLS により admin/manager/support 以外には行が返らない。
 * 取込は lib/domain/import_withdrawals.ts(admin/サービスロール)側で行う。
 */

import { createClient } from '@/lib/supabase/server';

export interface WithdrawalParentRow {
  id: string;
  member_id: string | null;
  member_name: string | null;
  project_name: string | null;
  campaign: string | null;
  principal: number | null;
  profit: number | null;
  total_amount: number | null;
  created_at: string;
  updated_at: string;
}

export interface WithdrawalChildRow {
  id: string;
  parent_no: string | null;
  parent_id: string | null;
  member_id: string | null;
  member_name: string | null;
  project_name: string | null;
  campaign: string | null;
  withdrawal_date: string | null;
  amount: number | null;
  created_at: string;
  updated_at: string;
}

const PARENT_COLS =
  'id,member_id,member_name,project_name,campaign,principal,profit,total_amount,created_at,updated_at';
const CHILD_COLS =
  'id,parent_no,parent_id,member_id,member_name,project_name,campaign,withdrawal_date,amount,created_at,updated_at';

/** 一覧でソート可能なカラム(SortHeader からの ?sort= を受ける) */
const PARENT_SORTABLE = new Set([
  'id',
  'member_id',
  'member_name',
  'project_name',
  'campaign',
  'principal',
  'profit',
  'total_amount',
]);
const CHILD_SORTABLE = new Set([
  'id',
  'parent_no',
  'member_id',
  'member_name',
  'project_name',
  'campaign',
  'withdrawal_date',
  'amount',
]);

export interface WithdrawalListParams {
  q?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface WithdrawalListResult<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listWithdrawalParents(
  params: WithdrawalListParams = {},
): Promise<WithdrawalListResult<WithdrawalParentRow>> {
  const supabase = await createClient();
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, params.pageSize ?? 50));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('withdrawal_parents')
    .select(PARENT_COLS, { count: 'exact' })
    .is('deleted_at', null);

  if (params.sort && PARENT_SORTABLE.has(params.sort)) {
    query = query.order(params.sort, { ascending: params.dir !== 'desc', nullsFirst: false });
  }
  // 既定は 償還-親No の新しい順
  query = query.order('id', { ascending: false }).range(from, to);

  if (params.q?.trim()) {
    const q = params.q.trim().replace(/[%_]/g, '\\$&');
    query = query.or(
      `id.ilike.%${q}%,member_id.ilike.%${q}%,member_name.ilike.%${q}%,project_name.ilike.%${q}%`,
    );
  }

  const { data, error, count } = await query;
  if (error) throw new Error(`出金管理-親の取得に失敗: ${error.message}`);
  return { rows: (data ?? []) as WithdrawalParentRow[], total: count ?? 0, page, pageSize };
}

export async function listWithdrawalChildren(
  params: WithdrawalListParams & { parentId?: string } = {},
): Promise<WithdrawalListResult<WithdrawalChildRow>> {
  const supabase = await createClient();
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, params.pageSize ?? 50));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('withdrawal_children')
    .select(CHILD_COLS, { count: 'exact' })
    .is('deleted_at', null);

  if (params.parentId) query = query.eq('parent_id', params.parentId);

  if (params.sort && CHILD_SORTABLE.has(params.sort)) {
    query = query.order(params.sort, { ascending: params.dir !== 'desc', nullsFirst: false });
  }
  // 既定は出金日の新しい順 → 同日内は 償還-子No の新しい順
  query = query
    .order('withdrawal_date', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })
    .range(from, to);

  if (params.q?.trim()) {
    const q = params.q.trim().replace(/[%_]/g, '\\$&');
    query = query.or(
      `id.ilike.%${q}%,parent_no.ilike.%${q}%,member_id.ilike.%${q}%,member_name.ilike.%${q}%,project_name.ilike.%${q}%`,
    );
  }

  const { data, error, count } = await query;
  if (error) throw new Error(`出金管理-子の取得に失敗: ${error.message}`);
  return { rows: (data ?? []) as WithdrawalChildRow[], total: count ?? 0, page, pageSize };
}

export async function getWithdrawalParent(id: string): Promise<WithdrawalParentRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('withdrawal_parents')
    .select(PARENT_COLS)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(`出金管理-親の取得に失敗: ${error.message}`);
  return (data as WithdrawalParentRow) ?? null;
}

export async function getWithdrawalChild(id: string): Promise<WithdrawalChildRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('withdrawal_children')
    .select(CHILD_COLS)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(`出金管理-子の取得に失敗: ${error.message}`);
  return (data as WithdrawalChildRow) ?? null;
}

/** 親詳細ページ用: 指定親に紐づく子(出金)を出金日の新しい順で返す(失敗時は空配列) */
export async function getChildrenByParent(parentId: string): Promise<WithdrawalChildRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('withdrawal_children')
    .select(CHILD_COLS)
    .eq('parent_id', parentId)
    .is('deleted_at', null)
    .order('withdrawal_date', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })
    .limit(200);
  if (error) return [];
  return (data ?? []) as WithdrawalChildRow[];
}
