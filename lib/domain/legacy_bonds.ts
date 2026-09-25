/**
 * 旧社債管理(legacy_bonds)ドメインロジック(CLAUDE.md §5.13c。migration 118)
 *
 * 一覧・詳細・会員詳細の関連の参照。RLS により admin 以外には行が返らない。
 * 取込は lib/domain/import_legacy_bonds.ts(admin / サービスロール)側で行う。
 */

import { createClient } from '@/lib/supabase/server';
import { LEGACY_BOND_RESULT_NONE, normalizeRedemptionMonth } from './legacy_bonds_pure';

export interface LegacyBondRow {
  id: string;
  member_id: string | null;
  member_name: string | null;
  application_no: string | null;
  application_id: string | null;
  project_name: string | null;
  project_id: string | null;
  bond_name: string | null;
  payment_amount: number | null;
  redemption_month: string | null;
  redemption_amount: number | null;
  prev_principal: number | null;
  prev_years: number | null;
  prev_interest_rate: number | null;
  interest: number | null;
  withholding_tax: number | null;
  result: string | null;
  contract_sent_date: string | null;
  partial_continue_amount: number | null;
  partial_redemption_amount: number | null;
  bank_info: string | null;
  created_at: string;
  updated_at: string;
}

const COLS =
  'id,member_id,member_name,application_no,application_id,project_name,project_id,bond_name,payment_amount,redemption_month,redemption_amount,prev_principal,prev_years,prev_interest_rate,interest,withholding_tax,result,contract_sent_date,partial_continue_amount,partial_redemption_amount,bank_info,created_at,updated_at';

/** 一覧でソート可能なカラム(SortHeader からの ?sort= を受ける) */
const SORTABLE = new Set([
  'id',
  'member_id',
  'member_name',
  'application_no',
  'project_name',
  'bond_name',
  'payment_amount',
  'redemption_month',
  'redemption_amount',
  'prev_principal',
  'prev_years',
  'prev_interest_rate',
  'interest',
  'withholding_tax',
  'result',
  'contract_sent_date',
  'partial_continue_amount',
  'partial_redemption_amount',
]);

export interface LegacyBondListParams {
  q?: string;
  /** 社債名(完全一致) */
  bondName?: string;
  /** 今回の結果(完全一致。LEGACY_BOND_RESULT_NONE は未入力) */
  result?: string;
  /** 償還対象月の範囲(YYYY-MM / YYYY/MM。両端を含む) */
  monthFrom?: string;
  monthTo?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface LegacyBondListResult {
  rows: LegacyBondRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listLegacyBonds(
  params: LegacyBondListParams = {},
): Promise<LegacyBondListResult> {
  const supabase = await createClient();
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, params.pageSize ?? 50));
  const rangeFrom = (page - 1) * pageSize;
  const rangeTo = rangeFrom + pageSize - 1;

  let query = supabase.from('legacy_bonds').select(COLS, { count: 'exact' }).is('deleted_at', null);

  if (params.sort && SORTABLE.has(params.sort)) {
    query = query.order(params.sort, { ascending: params.dir !== 'desc', nullsFirst: false });
  }
  // 既定は償還対象月の新しい順 → 同月内は ID の新しい順
  query = query
    .order('redemption_month', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })
    .range(rangeFrom, rangeTo);

  if (params.q?.trim()) {
    const q = params.q.trim().replace(/[%_]/g, '\\$&');
    query = query.or(
      `id.ilike.%${q}%,member_id.ilike.%${q}%,member_name.ilike.%${q}%,application_no.ilike.%${q}%,bond_name.ilike.%${q}%,result.ilike.%${q}%`,
    );
  }
  if (params.bondName) query = query.eq('bond_name', params.bondName);
  if (params.result === LEGACY_BOND_RESULT_NONE) query = query.is('result', null);
  else if (params.result) query = query.eq('result', params.result);
  // 償還対象月は "YYYY/MM" の文字列なので、同じ形にそろえて文字列で範囲比較する
  const from = normalizeRedemptionMonth(params.monthFrom);
  const to = normalizeRedemptionMonth(params.monthTo);
  if (from) query = query.gte('redemption_month', from);
  if (to) query = query.lte('redemption_month', to);

  const { data, error, count } = await query;
  if (error) throw new Error(`旧社債管理の取得に失敗: ${error.message}`);
  return { rows: (data ?? []) as LegacyBondRow[], total: count ?? 0, page, pageSize };
}

export async function getLegacyBond(id: string): Promise<LegacyBondRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('legacy_bonds')
    .select(COLS)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(`旧社債管理の取得に失敗: ${error.message}`);
  return (data as LegacyBondRow) ?? null;
}

/** 会員詳細ページ用: 指定会員の旧社債を償還対象月の新しい順で返す(失敗時・権限なしは空配列) */
export async function getLegacyBondsByMember(
  memberId: string,
  limit = 100,
): Promise<LegacyBondRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('legacy_bonds')
    .select(COLS)
    .eq('member_id', memberId)
    .is('deleted_at', null)
    .order('redemption_month', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as LegacyBondRow[];
}

/** 一覧のフィルタの選択肢(社債名・今回の結果。件数が少ないので全行から集める。失敗時は空) */
export async function listLegacyBondFilterOptions(): Promise<{
  bondNames: string[];
  results: string[];
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('legacy_bonds')
    .select('bond_name, result')
    .is('deleted_at', null)
    .limit(5000);
  if (error) return { bondNames: [], results: [] };
  const bonds = new Set<string>();
  const results = new Set<string>();
  for (const r of (data ?? []) as Array<{ bond_name: string | null; result: string | null }>) {
    if (r.bond_name) bonds.add(r.bond_name);
    if (r.result) results.add(r.result);
  }
  return { bondNames: [...bonds].sort(), results: [...results].sort() };
}
