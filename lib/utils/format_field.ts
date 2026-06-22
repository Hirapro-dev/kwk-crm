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
      return n.toLocaleString();
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
 * - DB物理カラム (is_in_db=true) → record[field_name]
 * - extra jsonb (is_in_db=false) → record.extra?.[field_name]
 */
export function getFieldValue(
  record: Record<string, unknown>,
  fieldName: string,
  isInDb: boolean,
): unknown {
  if (isInDb) {
    return record[fieldName];
  }
  const extra = record.extra as Record<string, unknown> | null | undefined;
  return extra?.[fieldName];
}
