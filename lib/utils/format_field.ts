/**
 * field_definitions.data_type に基づいて値をフォーマットする。
 *
 * オブジェクト管理機能 (Phase 2) で詳細画面/一覧画面の動的レンダリングに使用。
 */

import { formatDate, formatDateTime } from './date';

export type FieldDataType =
  | 'text'
  | 'number'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'enum'
  | 'jsonb';

/**
 * フィールド値を表示用文字列に整形する。
 * 空・null は '-' を返す。
 */
export function formatFieldValue(value: unknown, dataType: FieldDataType): string {
  if (value === null || value === undefined || value === '') return '-';

  switch (dataType) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) return String(value);
      return new Intl.NumberFormat('ja-JP').format(n);
    }
    case 'date': {
      if (typeof value !== 'string') return String(value);
      return formatDate(value) || value;
    }
    case 'datetime': {
      if (typeof value !== 'string') return String(value);
      return formatDateTime(value) || value;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value ? 'はい' : 'いいえ';
      if (value === 'true' || value === '1') return 'はい';
      if (value === 'false' || value === '0') return 'いいえ';
      return String(value);
    }
    case 'jsonb': {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    case 'enum':
    case 'text':
    default:
      return String(value);
  }
}

/**
 * 任意のオブジェクトから、field_name に対応する値を取り出す。
 *
 * 新形式 (field_name = CSV列名):
 *   extra[fieldName] を直接参照。
 *
 * 後方互換フォールバック (旧 extra_NNN 形式 / legacy_breakdown):
 *   1. extra[csvColumnName]
 *   2. extra.legacy_breakdown[csvColumnName]  (旧 04_members.ts 格納形式)
 */
export function getFieldValue(
  record: Record<string, unknown>,
  fieldName: string,
  isInDb: boolean,
  csvColumnName?: string | null,
): unknown {
  if (isInDb) return record[fieldName];

  const extra = record.extra as Record<string, unknown> | null | undefined;
  if (!extra) return undefined;

  // 新形式: field_name = CSV列名 → extra に直接キーが存在する
  if (fieldName in extra) return extra[fieldName];

  // 後方互換: csv_column_name で直接参照
  if (csvColumnName && csvColumnName in extra) return extra[csvColumnName];

  // 後方互換: 旧 legacy_breakdown ネスト構造
  const key = csvColumnName ?? fieldName;
  const breakdown = extra.legacy_breakdown as Record<string, unknown> | null | undefined;
  if (breakdown?.[key] !== undefined) return breakdown[key];

  return undefined;
}
