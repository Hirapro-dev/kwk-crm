/**
 * レポート実行(仕様書 §9.8, §9.14)
 *
 * Phase 0 雛形の execute.ts は編集禁止のため、本ファイルで本実装する。
 *
 * 流れ:
 *   1. buildReportQuery() で SQL + params を生成
 *   2. supabase.rpc('exec_report_sql', { query_sql, query_params }) で実行
 *   3. 結果は jsonb[] を Array<Record> として返却
 *   4. RLS は呼び出しユーザーで効くため、sales は自分担当の会員のみ取得される
 */

import { createClient } from '@/lib/supabase/server';
import { buildReportQuery, BuilderError, DEFAULT_ROW_LIMIT } from './builder_v2';
import { loadExtraColumnsForReportType } from './extra_columns';
import type { ReportDefinition, ReportTypeId } from './types';

export interface ReportColumnInfo {
  id: string;
  label: string;
  alias: string;
  /** 論理ソース名(例: 'm.name')。会員詳細リンク等の列判定に使う */
  source: string;
  dataType: string;
}

export interface ReportResult {
  columns: ReportColumnInfo[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  durationMs: number;
  truncated: boolean;
  /** デバッグ用に生成 SQL(本番では UI 非表示) */
  debugSql?: string;
}

export interface ExecuteOptions {
  /** Excel 出力時のみ true にして 50,000 行に拡張 */
  excelMode?: boolean;
  /** デバッグ用 SQL を返すか */
  includeDebugSql?: boolean;
}

export interface ExecuteError {
  ok: false;
  error: string;
}

export type ExecuteResponse = ({ ok: true } & ReportResult) | ExecuteError;

export async function executeReport(
  reportType: ReportTypeId,
  definition: ReportDefinition,
  currentUserId: string,
  options: ExecuteOptions = {},
): Promise<ExecuteResponse> {
  // 主軸オブジェクトの extra jsonb キー一覧を取得して SQL Builder に渡す。
  // これにより CSV 由来の動的カラムもプレビュー/保存実行で利用可能になる。
  const extraColumns = await loadExtraColumnsForReportType(reportType);

  let built: ReturnType<typeof buildReportQuery>;
  try {
    const def = options.excelMode
      ? { ...definition, row_limit: 50_000 }
      : definition;
    built = buildReportQuery(reportType, def, currentUserId, extraColumns);
  } catch (e) {
    if (e instanceof BuilderError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const supabase = await createClient();
  const startedAt = Date.now();
  const { data, error } = await supabase.rpc('exec_report_sql', {
    query_sql: built.sql,
    query_params: built.params,
  });
  const durationMs = Date.now() - startedAt;

  if (error) {
    return { ok: false, error: `実行失敗: ${error.message}` };
  }

  const rows = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;
  const rowLimit =
    definition.row_limit ?? (options.excelMode ? 50_000 : DEFAULT_ROW_LIMIT);
  return {
    ok: true,
    columns: built.columns,
    rows,
    rowCount: rows.length,
    durationMs,
    truncated: rows.length >= rowLimit,
    debugSql: options.includeDebugSql ? built.sql : undefined,
  };
}
