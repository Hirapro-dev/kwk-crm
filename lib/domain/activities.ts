import { createClient } from '@/lib/supabase/server';
import type { ActivityListItem } from './types';

export interface ActivityListParams {
  memberId?: string;
  ownerId?: string;
  dBunrui?: string;
  from?: string; // ISO date
  to?: string; // ISO date
  page?: number;
  pageSize?: number;
}

export interface ActivityListResult {
  rows: ActivityListItem[];
  total: number;
  page: number;
  pageSize: number;
}

const DEFAULT_PAGE_SIZE = 50;

export async function listActivities(params: ActivityListParams = {}): Promise<ActivityListResult> {
  const supabase = await createClient();
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, params.pageSize ?? DEFAULT_PAGE_SIZE));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('activities')
    .select(
      `
        id, legacy_sf_id, owner_id, member_id, created_by_id,
        description, d_bunrui, m_bunrui, s_bunrui,
        registered_date, registered_datetime, created_at, updated_at,
        owner:users!activities_owner_id_fkey(id, full_name),
        member:members!activities_member_id_fkey(id, name)
      `,
      { count: 'exact' },
    )
    .is('deleted_at', null)
    .order('registered_datetime', { ascending: false, nullsFirst: false })
    .range(from, to);

  if (params.memberId) query = query.eq('member_id', params.memberId);
  if (params.ownerId) query = query.eq('owner_id', params.ownerId);
  if (params.dBunrui) query = query.eq('d_bunrui', params.dBunrui);
  if (params.from) query = query.gte('registered_datetime', params.from);
  if (params.to) query = query.lte('registered_datetime', params.to);

  const { data, error, count } = await query;
  if (error) throw new Error(`対応歴一覧取得に失敗: ${error.message}`);

  return {
    rows: (data ?? []) as unknown as ActivityListItem[],
    total: count ?? 0,
    page,
    pageSize,
  };
}

/**
 * 対応分類のユニーク値を取得(プルダウン用)。
 * 仕様書 §8.3: 既存値を抽出し分類マスタとして提示する。
 */
export async function getDBunruiList(): Promise<string[]> {
  const supabase = await createClient();
  // RPC が無いので 1ページ分(=最近の対応歴の分類)から重複排除する簡易版。
  // 将来は activities_d_bunrui_unique のような view を作る。
  const { data, error } = await supabase
    .from('activities')
    .select('d_bunrui')
    .not('d_bunrui', 'is', null)
    .is('deleted_at', null)
    .order('registered_datetime', { ascending: false, nullsFirst: false })
    .limit(2000);
  if (error) return [];
  const set = new Set<string>();
  for (const r of data ?? []) {
    if (r.d_bunrui) set.add(r.d_bunrui as string);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'ja'));
}

export interface BunruiPair {
  d_bunrui: string;
  m_bunrui: string | null;
  s_bunrui: string | null;
}

export async function getRecentBunruiPairs(limit = 50): Promise<BunruiPair[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('activities')
    .select('d_bunrui, m_bunrui, s_bunrui')
    .not('d_bunrui', 'is', null)
    .is('deleted_at', null)
    .order('registered_datetime', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) return [];
  const seen = new Set<string>();
  const out: BunruiPair[] = [];
  for (const r of data ?? []) {
    const key = `${r.d_bunrui}|${r.m_bunrui ?? ''}|${r.s_bunrui ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      d_bunrui: r.d_bunrui as string,
      m_bunrui: (r.m_bunrui as string | null) ?? null,
      s_bunrui: (r.s_bunrui as string | null) ?? null,
    });
  }
  return out;
}
