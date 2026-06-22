/**
 * ダッシュボードのお気に入りレポートウィジェット用データ取得
 * 仕様書 §9.15:「お気に入りレポートのウィジェット(最大3個)」
 */

import { createClient } from '@/lib/supabase/server';
import { executeReport } from '@/lib/reports/execute_v2';
import type { ReportTypeId } from '@/lib/reports/types';
import type { ReportFull } from './reports';

export interface DashboardWidget {
  reportId: string;
  name: string;
  reportType: string;
  rows: Array<Record<string, unknown>>;
  columns: Array<{ id: string; label: string; alias: string }>;
  truncated: boolean;
  error?: string;
}

const MAX_WIDGETS = 3;
const WIDGET_ROW_LIMIT = 10;

export async function getFavoriteReportWidgets(
  userId: string,
): Promise<DashboardWidget[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reports')
    .select(
      'id, name, report_type, definition, visibility, is_standard, favorited_by',
    )
    .is('deleted_at', null)
    .contains('favorited_by', [userId])
    .order('name')
    .limit(MAX_WIDGETS);
  if (error || !data) return [];

  const widgets: DashboardWidget[] = [];
  for (const r of data as unknown as ReportFull[]) {
    const reportType: ReportTypeId =
      r.report_type === 'custom' ? 'RT01' : (r.report_type as ReportTypeId);
    // 件数を絞ってサマリ表示
    const def = {
      ...r.definition,
      row_limit: WIDGET_ROW_LIMIT,
    };
    const res = await executeReport(reportType, def, userId);
    if (!res.ok) {
      widgets.push({
        reportId: r.id,
        name: r.name,
        reportType: r.report_type,
        rows: [],
        columns: [],
        truncated: false,
        error: res.error,
      });
      continue;
    }
    widgets.push({
      reportId: r.id,
      name: r.name,
      reportType: r.report_type,
      rows: res.rows,
      columns: res.columns,
      truncated: res.truncated,
    });
  }
  return widgets;
}
