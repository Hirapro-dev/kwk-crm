/**
 * 申込の CSV 出力(サマリの入金一覧の CSV。CLAUDE.md §8.1 `/summary`。出力規約は §9.11)。純粋関数。
 *
 * - 列は画面の申込一覧と同じ(項目管理の「一覧」表示 ON の項目を渡す)。値も画面と同じ見え方
 *   (名前・日本時間の日付・利息の % / 契約期間の ヶ月)にする。
 * - ただし金額は Excel で計算できるよう数字だけ(¥ とカンマを付けない)、空の値は「-」ではなく空欄。
 * - 会員は突合に使えるよう 会員ID と 会員名 の 2 列に分ける(画面は会員名のリンク)。
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

type CsvField = Pick<
  FieldDefinition,
  'field_name' | 'label' | 'data_type' | 'is_in_db' | 'csv_column_name'
>;

/** 見出し行。会員だけは 会員ID と 会員名 の 2 列 */
export function applicationCsvHeaders(fields: readonly CsvField[]): string[] {
  return fields.flatMap((f) =>
    f.field_name === 'member_id' ? ['会員ID', '会員名'] : [f.label ?? f.field_name],
  );
}

function cells(a: ApplicationListItem, f: CsvField): string[] {
  const rec = a as unknown as Record<string, unknown>;
  switch (f.field_name) {
    case 'id':
      return [a.id];
    case 'member_id':
      return [a.member?.id ?? a.member_id ?? '', a.member?.name ?? ''];
    case 'project_id':
      return [a.project?.name ?? ''];
    case 'owner_id':
      return [a.owner?.full_name ?? a.owner_name_raw ?? ''];
    case 'acquirer_id':
      return [a.acquirer?.full_name ?? a.acquirer_name_raw ?? ''];
    case 'status':
      return [a.status ?? ''];
  }
  if (APPLICATION_AMOUNT_FIELDS.has(f.field_name)) {
    const v = rec[f.field_name];
    if (v === null || v === undefined || v === '') return [''];
    const n = Number(v);
    return [Number.isFinite(n) ? String(n) : String(v)];
  }
  const raw = getFieldValue(rec, f.field_name, f.is_in_db, f.csv_column_name);
  const text =
    formatApplicationUnitValue(f.field_name, raw) ??
    formatFieldValue(raw, f.data_type, f.label ?? f.field_name);
  return [text === '-' ? '' : text];
}

/** 申込の行を CSV 文字列(BOM 付き)にする */
export function toApplicationsCsv(
  rows: readonly ApplicationListItem[],
  fields: readonly CsvField[],
): string {
  const lines = [applicationCsvHeaders(fields).map(escapeCsvCell).join(',')];
  for (const a of rows) {
    lines.push(
      fields
        .flatMap((f) => cells(a, f))
        .map(escapeCsvCell)
        .join(','),
    );
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
