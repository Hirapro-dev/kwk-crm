import type { ReportDefinition, ReportTypeId } from '@/lib/reports/types';
import { createClient } from '@/lib/supabase/server';

export type ReportVisibility = 'private' | 'team' | 'public' | 'restricted';

export interface ReportSummary {
  id: string;
  name: string;
  description: string | null;
  report_type: ReportTypeId | 'custom';
  visibility: ReportVisibility;
  /** visibility=restricted のとき閲覧を許可するユーザーID群 */
  shared_with: string[];
  is_standard: boolean;
  created_by: string;
  last_run_at: string | null;
  last_run_duration_ms: number | null;
  last_run_row_count: number | null;
  favorited_by: string[];
  created_at: string;
  updated_at: string;
  creator: { id: string; full_name: string | null; email: string } | null;
}

export interface ReportFull extends ReportSummary {
  definition: ReportDefinition;
  folder_id: string | null;
}

// shared_with は migration 54 で追加。未適用環境では列が無く SELECT がエラーになるため、
// 列ありでまず試し、失敗したら列なしで再取得するフォールバックを行う(画面を壊さない)。
const isMissingSharedWith = (msg: string | undefined): boolean => !!msg && /shared_with/.test(msg);

export async function listReports(filter?: {
  favoritesOnly?: boolean;
  standardOnly?: boolean;
  userId?: string;
  /** 名前・説明の部分一致検索 */
  q?: string;
  /** 自分が作成したレポートのみ(created_by = userId) */
  mineOnly?: boolean;
}): Promise<ReportSummary[]> {
  const supabase = await createClient();
  const build = (withShared: boolean) => {
    let q = supabase
      .from('reports')
      .select(
        `
        id, name, description, report_type, visibility,${withShared ? ' shared_with,' : ''} is_standard,
        created_by, last_run_at, last_run_duration_ms, last_run_row_count,
        favorited_by, created_at, updated_at,
        creator:users!reports_created_by_fkey(id, full_name, email)
      `,
      )
      .is('deleted_at', null)
      .order('is_standard', { ascending: false })
      .order('name', { ascending: true });
    if (filter?.standardOnly) q = q.eq('is_standard', true);
    if (filter?.favoritesOnly && filter.userId) {
      q = q.contains('favorited_by', [filter.userId]);
    }
    if (filter?.mineOnly && filter.userId) {
      q = q.eq('created_by', filter.userId);
    }
    if (filter?.q && filter.q.trim()) {
      const kw = filter.q.trim().replace(/[%_]/g, '\\$&');
      q = q.or(`name.ilike.%${kw}%,description.ilike.%${kw}%`);
    }
    return q;
  };

  let { data, error } = await build(true);
  if (error && isMissingSharedWith(error.message)) {
    ({ data, error } = await build(false));
  }
  if (error) throw new Error(`レポート一覧取得に失敗: ${error.message}`);
  return ((data ?? []) as unknown as ReportSummary[]).map((r) => ({
    ...r,
    shared_with: r.shared_with ?? [],
  }));
}

export async function getReport(id: string): Promise<ReportFull | null> {
  const supabase = await createClient();
  const build = (withShared: boolean) =>
    supabase
      .from('reports')
      .select(
        `
        id, name, description, report_type, visibility,${withShared ? ' shared_with,' : ''} is_standard,
        folder_id, definition, favorited_by,
        created_by, last_run_at, last_run_duration_ms, last_run_row_count,
        created_at, updated_at,
        creator:users!reports_created_by_fkey(id, full_name, email)
      `,
      )
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();

  let { data, error } = await build(true);
  if (error && isMissingSharedWith(error.message)) {
    ({ data, error } = await build(false));
  }
  if (error) throw new Error(`レポート取得に失敗: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as ReportFull;
  return { ...row, shared_with: row.shared_with ?? [] };
}
