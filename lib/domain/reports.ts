import { createClient } from '@/lib/supabase/server';
import type { ReportDefinition, ReportTypeId } from '@/lib/reports/types';

export interface ReportSummary {
  id: string;
  name: string;
  description: string | null;
  report_type: ReportTypeId | 'custom';
  visibility: 'private' | 'team' | 'public';
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

export async function listReports(filter?: {
  favoritesOnly?: boolean;
  standardOnly?: boolean;
  userId?: string;
}): Promise<ReportSummary[]> {
  const supabase = await createClient();
  let q = supabase
    .from('reports')
    .select(
      `
        id, name, description, report_type, visibility, is_standard,
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

  const { data, error } = await q;
  if (error) throw new Error(`レポート一覧取得に失敗: ${error.message}`);
  return (data ?? []) as unknown as ReportSummary[];
}

export async function getReport(id: string): Promise<ReportFull | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reports')
    .select(
      `
        id, name, description, report_type, visibility, is_standard,
        folder_id, definition, favorited_by,
        created_by, last_run_at, last_run_duration_ms, last_run_row_count,
        created_at, updated_at,
        creator:users!reports_created_by_fkey(id, full_name, email)
      `,
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(`レポート取得に失敗: ${error.message}`);
  return (data as unknown as ReportFull) ?? null;
}
