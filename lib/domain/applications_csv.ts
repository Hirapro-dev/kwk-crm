/**
 * 申込の CSV 出力(サマリの入金一覧の CSV。CLAUDE.md §8.1 `/summary`。出力規約は §9.11)。純粋関数。
 *
 * - 列は渡された項目のとおり(入金一覧は PAYMENT_LIST_FIELDS)。値は画面と同じ見え方
 *   (名前・日本時間の日付・利息の % / 契約期間の ヶ月)にする。
 * - ただし金額は Excel で計算できるよう数字だけ(¥ とカンマを付けない)、空の値は「-」ではなく空欄。
 * - UTF-8 BOM 付き・CRLF(対応歴の CSV と同じ)。
 */

import { formatApplicationUnitValue } from '@/lib/domain/application_units';
import { formatDateTime } from '@/lib/utils/date';
import { formatFieldValue, getFieldValue } from '@/lib/utils/format_field';
import { escapeCsvCell } from './activities_csv';
import type { ApplicationListItem } from './applications';
import type { FieldDefinition } from './object_metadata';

/** 金額の列(画面では ¥ + 右寄せ。CSV では数字だけ) */
export const APPLICATION_AMOUNT_FIELDS: ReadonlySet<string> = new Set([
  'payment_amount',
  'scheduled_amount',
  'withdrawal_amount',
  'transfer_amount',
  'crypto_excluded_amount',
]);

/**
 * 申込の一覧・CSV の 1 列。項目管理の定義(FieldDefinition)か、入金一覧の固定列(PAYMENT_LIST_FIELDS)。
 * field_name には DB 列・可変項目のほか、`member_code`(会員ID)/ `member_name`(会員氏名)も使える。
 * sortField: 並び替えに使う列。null = 並び替えなし、省略 = DB 列ならその列。
 */
export type ApplicationListField = Pick<
  FieldDefinition,
  'id' | 'field_name' | 'label' | 'data_type' | 'is_in_db' | 'csv_column_name'
> & { sortField?: string | null };

type CsvField = Omit<ApplicationListField, 'id' | 'sortField'>;

/** 見出し行 */
export function applicationCsvHeaders(fields: readonly CsvField[]): string[] {
  return fields.map((f) => f.label ?? f.field_name);
}

function cell(a: ApplicationListItem, f: CsvField): string {
  const rec = a as unknown as Record<string, unknown>;
  switch (f.field_name) {
    case 'id':
      return a.id;
    case 'member_code':
      return a.member?.id ?? a.member_id ?? '';
    case 'member_name':
      return a.member?.name ?? '';
    case 'project_id':
      return a.project?.name ?? '';
    case 'owner_id':
      return a.owner?.full_name ?? a.owner_name_raw ?? '';
    case 'acquirer_id':
      return a.acquirer?.full_name ?? a.acquirer_name_raw ?? '';
    case 'status':
      return a.status ?? '';
  }
  if (APPLICATION_AMOUNT_FIELDS.has(f.field_name)) {
    const v = rec[f.field_name];
    if (v === null || v === undefined || v === '') return '';
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : String(v);
  }
  const raw = getFieldValue(rec, f.field_name, f.is_in_db, f.csv_column_name);
  const text =
    formatApplicationUnitValue(f.field_name, raw) ??
    formatFieldValue(raw, f.data_type, f.label ?? f.field_name);
  return text === '-' ? '' : text;
}

/** 申込の行を CSV 文字列(BOM 付き)にする */
export function toApplicationsCsv(
  rows: readonly ApplicationListItem[],
  fields: readonly CsvField[],
): string {
  const lines = [applicationCsvHeaders(fields).map(escapeCsvCell).join(',')];
  for (const a of rows) {
    lines.push(fields.map((f) => escapeCsvCell(cell(a, f))).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** ファイル名。例: 入金一覧_20261001-20261031_20261102.csv / 入金一覧_20261102.csv(全期間) */
export function buildPaymentCsvFilename(
  range: { from: string | null; to: string | null },
  now = new Date(),
): string {
  const stamp = formatDateTime(now).slice(0, 10).replace(/\//g, '');
  const ymd = (d: string | null) => (d ? d.replace(/-/g, '') : '');
  const span = range.from || range.to ? `${ymd(range.from)}-${ymd(range.to)}_` : '';
  return `入金一覧_${span}${stamp}.csv`;
}
