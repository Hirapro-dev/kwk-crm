/**
 * CSV テキスト → 取込レコードへの変換・検証 (サーバー側)。
 * CSV パースは導入済みの xlsx を流用(引用符・カンマ込みの値も正しく処理)。
 */

import * as XLSX from 'xlsx';
import { coerceValue, isCoerceErr } from './coerce';
import type { ImportField, ImportObjectDef } from './schema';

export interface RowError {
  row: number; // 1始まり(ヘッダーを除いたデータ行番号)
  message: string;
}

export interface MappedRecord {
  row: number;
  data: Record<string, unknown>;
  id: string;
}

export interface MapResult {
  records: MappedRecord[];
  errors: RowError[];
  /** CSV に存在し取込対象になった項目 */
  presentFields: ImportField[];
  /** CSV にあるが取込対象外として無視したヘッダー */
  ignoredHeaders: string[];
  totalRows: number;
}

/** CSV 文字列を {ヘッダー: 値文字列} の配列にする */
export function parseCsv(csvText: string): Array<Record<string, string>> {
  const wb = XLSX.read(csvText, { type: 'string', raw: false });
  const first = wb.SheetNames[0];
  if (!first) return [];
  const ws = wb.Sheets[first];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<Record<string, string>>(ws, {
    defval: '',
    raw: false,
  });
}

/**
 * 生CSV行をオブジェクト定義に従って検証・マッピングする。
 * - CSV に存在する列のみ取込対象にする(存在しない列は触らない=既存値を保持)
 * - 主キーが空の行はエラー
 * - 値変換エラーのある行はエラー扱いで records から除外
 */
export function mapAndValidate(
  def: ImportObjectDef,
  rawRows: Array<Record<string, string>>,
): MapResult {
  const labelToField = new Map<string, ImportField>();
  for (const f of def.fields) labelToField.set(f.label, f);

  const headers = rawRows.length > 0 ? Object.keys(rawRows[0]!) : [];
  const presentFields = def.fields.filter((f) => headers.includes(f.label));
  const ignoredHeaders = headers.filter((h) => !labelToField.has(h));

  const idField = def.fields.find((f) => f.field === def.idField)!;
  const records: MappedRecord[] = [];
  const errors: RowError[] = [];

  rawRows.forEach((raw, i) => {
    const rowNum = i + 1;
    const data: Record<string, unknown> = {};
    const rowErrors: string[] = [];

    // 主キー
    const idRaw = String(raw[idField.label] ?? '').trim();
    if (idRaw === '') {
      errors.push({ row: rowNum, message: `${idField.label} が空です` });
      return;
    }

    for (const f of presentFields) {
      const rawVal = String(raw[f.label] ?? '');
      const res = coerceValue(f.type, rawVal);
      if (isCoerceErr(res)) {
        rowErrors.push(`${f.label}: ${res.error}`);
        continue;
      }
      if (f.required && (res.value === null || res.value === '')) {
        rowErrors.push(`${f.label} は必須です`);
        continue;
      }
      data[f.field] = res.value;
    }

    if (rowErrors.length > 0) {
      errors.push({ row: rowNum, message: rowErrors.join(' / ') });
      return;
    }

    data[def.idField] = idRaw;
    records.push({ row: rowNum, data, id: idRaw });
  });

  return {
    records,
    errors,
    presentFields,
    ignoredHeaders,
    totalRows: rawRows.length,
  };
}
