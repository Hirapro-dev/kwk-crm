/**
 * レポート出力モジュール(Phase 6 で本実装)。
 * 仕様書 §9.11:
 *   - CSV: UTF-8 BOM 付き、日付は YYYY/MM/DD HH:mm
 *   - Excel(.xlsx): ヘッダ太字、数値カンマ区切り
 */

import type { ReportResult } from './execute';

export function toCsv(_result: ReportResult): string {
  throw new Error('toCsv is not implemented yet. See Phase 6 of CLAUDE.md.');
}

export function toXlsx(_result: ReportResult): Uint8Array {
  throw new Error('toXlsx is not implemented yet. See Phase 6 of CLAUDE.md.');
}
