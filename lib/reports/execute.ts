/**
 * レポート実行・結果取得モジュール(Phase 6 で実装)。
 *
 * RLS により実行ユーザーの権限で結果がフィルタされる(仕様書 §9.14)。
 */

import type { ReportDefinition, ReportTypeId } from './types';

export interface ReportResult {
  columns: Array<{ id: string; label: string }>;
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  durationMs: number;
  truncated: boolean;
}

export async function executeReport(
  _reportType: ReportTypeId,
  _definition: ReportDefinition,
): Promise<ReportResult> {
  throw new Error('executeReport is not implemented yet. See Phase 6 of CLAUDE.md.');
}
