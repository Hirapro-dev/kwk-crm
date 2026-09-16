/**
 * マスター管理(CLAUDE.md §5.18 広告マスタ / §5.19 顧客情報取得ポイントマスタ)の参照。
 * 案件マスタ(projects.ts)と同じく、参照は全ロール、変更は master_actions.ts(admin のみ)。
 */

import { createClient } from '@/lib/supabase/server';

export interface AdMaster {
  id: string;
  ad_type: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AcquisitionPointMaster {
  id: number;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const AD_COLS = 'id, ad_type, name, is_active, created_at, updated_at';
const POINT_COLS = 'id, name, sort_order, is_active, created_at, updated_at';

/** 広告マスタ一覧(広告種別で絞り込み、広告ID・媒体名の部分一致検索)。種別 → 広告ID 順 */
export async function listAdMasters(opts?: { q?: string; adType?: string }): Promise<AdMaster[]> {
  const supabase = await createClient();
  let query = supabase
    .from('ad_masters')
    .select(AD_COLS)
    .order('ad_type', { ascending: true })
    .order('id', { ascending: true });
  if (opts?.adType) query = query.eq('ad_type', opts.adType);
  if (opts?.q?.trim()) {
    const q = opts.q.trim().replace(/[%_]/g, '\\$&');
    query = query.or(`id.ilike.%${q}%,name.ilike.%${q}%`);
  }
  const { data, error } = await query;
  // migration 96 未適用でも画面を壊さない
  if (error) return [];
  return (data ?? []) as AdMaster[];
}

/** 広告種別の一覧(絞り込み用。登録順ではなく名前順) */
export async function listAdTypes(): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('ad_masters').select('ad_type');
  if (error) return [];
  const rows = (data ?? []) as unknown as Array<{ ad_type: string }>;
  return [...new Set(rows.map((r) => r.ad_type))].sort();
}

/** 顧客情報取得ポイントマスタ一覧(sort_order → 名前順) */
export async function listAcquisitionPoints(opts?: {
  activeOnly?: boolean;
}): Promise<AcquisitionPointMaster[]> {
  const supabase = await createClient();
  let query = supabase
    .from('acquisition_point_masters')
    .select(POINT_COLS)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (opts?.activeOnly) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) return [];
  return (data ?? []) as AcquisitionPointMaster[];
}

/** 広告ID → 広告媒体名 の対応表(無効な広告も含む。過去の値の表示用)。未適用なら空 */
export async function getAdNameMap(): Promise<Record<string, string>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('ad_masters').select('id, name');
  if (error) return {};
  const out: Record<string, string> = {};
  for (const r of (data ?? []) as unknown as Array<{ id: string; name: string }>)
    out[r.id] = r.name;
  return out;
}
