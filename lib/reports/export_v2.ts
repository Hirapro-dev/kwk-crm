/**
 * レポート出力(仕様書 §9.11)
 * Phase 0 の export.ts は編集禁止のため本ファイルで本実装。
 *
 * - CSV: UTF-8 BOM 付き、日付は YYYY/MM/DD HH:mm 形式
 * - Excel: xlsx ライブラリ、ヘッダ太字、数値カンマ区切り
 */

import { formatJstDateTimeHm, toJstExcelSerial } from '@/lib/utils/date';
import * as XLSX from 'xlsx';
import type { ReportResult } from './execute_v2';

function escapeCsvValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = formatValue(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') {
    // ISO 日時を YYYY/MM/DD HH:mm に整形(仕様書 §9.11)
    // サーバー(Vercel = UTC)の時刻帯ではなく日本時間で整形する
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
      const s = formatJstDateTimeHm(v);
      if (s) return s;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      return v.replace(/-/g, '/');
    }
    return v;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

/**
 * CSV(UTF-8 BOM 付き)に整形して返す。
 */
export function toCsv(result: ReportResult): string {
  const headers = result.columns.map((c) => c.label);
  const aliases = result.columns.map((c) => c.alias);
  const lines: string[] = [];
  lines.push(headers.map(escapeCsvValue).join(','));
  for (const row of result.rows) {
    lines.push(aliases.map((a) => escapeCsvValue(row[a])).join(','));
  }
  return `\uFEFF${lines.join('\n')}\n`;
}

/**
 * Excel (.xlsx) バイナリを Uint8Array で返す。
 * - ヘッダ太字、列幅自動
 * - 数値はそのまま数値型として書き出し(カンマ区切りはセル書式で表示)
 */
export function toXlsx(result: ReportResult, sheetName = 'Report'): Uint8Array {
  const headers = result.columns.map((c) => c.label);
  const aliases = result.columns.map((c) => c.alias);

  // 2次元配列に変換
  const matrix: unknown[][] = [headers];
  // 日時セルの位置(行, 列)。後で日時の表示書式を付ける
  const dateCells: Array<[number, number]> = [];
  for (const row of result.rows) {
    const r = matrix.length;
    matrix.push(
      aliases.map((a, c) => {
        const v = row[a];
        // ISO 日時 → 日本時間の Excel シリアル値(Date を渡すとサーバーの時刻帯 = UTC で書かれるため)
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
          const serial = toJstExcelSerial(v);
          if (serial !== null) {
            dateCells.push([r, c]);
            return serial;
          }
        }
        return v ?? '';
      }),
    );
  }

  const ws = XLSX.utils.aoa_to_sheet(matrix);
  for (const [r, c] of dateCells) {
    const cell = ws[XLSX.utils.encode_cell({ r, c })];
    if (cell) cell.z = 'yyyy/mm/dd hh:mm';
  }

  // 列幅
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(10, Math.min(40, h.length + 2)) }));

  // ヘッダ行を太字に
  const headerRange = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
  for (let c = headerRange.s.c; c <= headerRange.e.c; c++) {
    const ref = XLSX.utils.encode_cell({ r: 0, c });
    if (ws[ref]) {
      ws[ref].s = { font: { bold: true } };
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31)); // sheet 名 31 字制限

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Uint8Array(buf as ArrayBuffer);
}
