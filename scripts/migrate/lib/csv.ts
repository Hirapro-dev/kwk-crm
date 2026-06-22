/**
 * 移行スクリプト共通: CSV パーサ
 * 仕様書 §6.2: 文字コード UTF-8 with BOM を考慮
 *
 * 依存追加を避けるため最小実装(RFC 4180 準拠の単純実装)。
 * - ダブルクォート囲み対応
 * - エスケープされたダブルクォート("") 対応
 * - 改行を含むフィールド対応
 * - BOM 除去
 */

import { readFileSync } from 'node:fs';

export interface CsvParseOptions {
  delimiter?: string;
  trimValues?: boolean;
}

export interface CsvRow {
  [column: string]: string;
}

/**
 * UTF-8 BOM を除去
 */
function stripBom(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) {
    return text.slice(1);
  }
  return text;
}

/**
 * CSV テキストを行・カラムに分解
 */
function parseCsvText(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }

    if (ch === delimiter) {
      row.push(field);
      field = '';
      i++;
      continue;
    }

    if (ch === '\r') {
      i++;
      continue;
    }

    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }

    field += ch;
    i++;
  }

  // 最終行(末尾改行がない場合)
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * CSV ファイルを読み込み、1行目をヘッダとして CsvRow[] を返す。
 */
export function readCsv(filepath: string, options: CsvParseOptions = {}): CsvRow[] {
  const { delimiter = ',', trimValues = false } = options;
  const raw = readFileSync(filepath, 'utf-8');
  const text = stripBom(raw);
  const rows = parseCsvText(text, delimiter);

  if (rows.length === 0) return [];
  const header = rows[0]!.map((h) => h.trim());
  const result: CsvRow[] = [];

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r]!;
    // 完全な空行はスキップ
    if (cells.length === 1 && cells[0] === '') continue;
    const obj: CsvRow = {};
    for (let c = 0; c < header.length; c++) {
      const key = header[c] ?? `_col${c}`;
      let value = cells[c] ?? '';
      if (trimValues) value = value.trim();
      obj[key] = value;
    }
    result.push(obj);
  }

  return result;
}

/**
 * 値を CSV 用にエスケープする。
 */
function escapeCsvValue(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * CsvRow[] を CSV テキスト(UTF-8 BOM 付き)にシリアライズする。
 * 仕様書 §9.11: CSV は UTF-8 BOM 付き
 */
export function toCsv(rows: CsvRow[], columns?: string[]): string {
  if (rows.length === 0 && (!columns || columns.length === 0)) return '\uFEFF';
  const headers = columns ?? Object.keys(rows[0]!);
  const lines: string[] = [];
  lines.push(headers.map(escapeCsvValue).join(','));
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvValue(row[h] ?? '')).join(','));
  }
  return `\uFEFF${lines.join('\n')}\n`;
}
