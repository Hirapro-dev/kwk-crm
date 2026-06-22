/**
 * 仕様書 §9.8: 安全な SQL Builder 本体。
 *
 * Phase 6 で実装。本ファイルは Phase 0 のスケルトンのみ。
 *
 * 設計方針(再掲):
 *   1. ホワイトリスト方式: REPORT_SCHEMAS にあるカラム/結合/フィルタのみ許可
 *   2. パラメータ化クエリ: 値は全て supabase-js のバインドパラメータで渡す
 *   3. クエリタイムアウト: 30秒 (statement_timeout)
 *   4. 結果上限: デフォルト 10,000 行、Excel 出力時は 50,000 行
 *   5. 開発時に EXPLAIN ANALYZE で実行計画を確認
 */

import type { ReportDefinition, ReportTypeId } from './types';

export interface BuiltQuery {
  sql: string;
  params: unknown[];
}

/**
 * レポート定義から SQL とパラメータを構築する。
 * Phase 6 で本格実装。
 */
export function buildReportQuery(
  _reportType: ReportTypeId,
  _definition: ReportDefinition,
  _currentUserId: string,
): BuiltQuery {
  throw new Error('buildReportQuery is not implemented yet. See Phase 6 of CLAUDE.md.');
}
