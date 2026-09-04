/**
 * 対応歴の CSV 出力(仕様書 §9.11 の出力規約に合わせる)。
 *
 * - UTF-8 BOM 付き(Excel で開いたときに文字化けさせない)
 * - 日時は `YYYY/MM/DD HH:mm`(画面表示と同じ formatDateTime を使い、JST で揃える)
 * - 改行は CRLF(Excel 互換。セル内改行を含むため LF のみだと崩れる環境がある)
 *
 * 列は対応歴一覧の画面と同じ並びにし、会員IDだけ追加する
 * (画面では会員名リンクだが、CSV では突合に使えるよう ID を分けて出す)。
 *
 * 純粋関数。DB アクセスはしない(取得は activities.ts の exportActivities)。
 */

import { formatDateTime } from '@/lib/utils/date';
import type { ActivityListItem } from './types';

export const ACTIVITY_CSV_HEADERS = [
  '日時',
  '会員ID',
  '会員名',
  '対応者',
  '接触種別',
  '接触内容',
  '状態',
  '対応詳細',
] as const;

/**
 * CSV の1セルを組み立てる。
 * 対応詳細には「、」「,」「"」や改行が普通に含まれるため、
 * 該当する場合は必ずダブルクォートで囲み、内部の " は "" に重ねる(RFC 4180)。
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s === '') return '';
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** 対応歴の行を CSV 文字列(BOM 付き)に変換する。 */
export function toActivitiesCsv(rows: ActivityListItem[]): string {
  const lines: string[] = [];
  lines.push(ACTIVITY_CSV_HEADERS.map(escapeCsvCell).join(','));

  for (const a of rows) {
    lines.push(
      [
        // 画面と同じく registered_datetime が無ければ created_at を出す
        formatDateTime(a.registered_datetime ?? a.created_at),
        a.member?.id ?? a.member_id ?? '',
        a.member?.name ?? '',
        a.owner?.full_name ?? '',
        a.d_bunrui ?? '',
        a.m_bunrui ?? '',
        // 状態は「通電|申込獲得」のようにパイプ区切りで入る。画面も原文のまま出すため揃える
        a.s_bunrui ?? '',
        a.description ?? '',
      ]
        .map(escapeCsvCell)
        .join(','),
    );
  }

  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/**
 * ダウンロード時のファイル名を組み立てる。
 * 例: 対応歴_20260904.csv / 対応歴_20260101-20260131_20260904.csv
 */
export function buildActivitiesCsvFilename(
  params: { from?: string; to?: string },
  now = new Date(),
): string {
  const stamp = formatDateTime(now).slice(0, 10).replace(/\//g, '');
  // from/to は 'YYYY-MM-DD'。区切りのハイフンを消してから範囲を '-' でつなぐ
  // (先に全体から '-' を消すと 20260101-20260131 が繋がってしまう)。
  const compact = (v?: string) => (v ? v.replace(/-/g, '') : '');
  const from = compact(params.from);
  const to = compact(params.to);
  const range = from || to ? `${from || '開始不問'}-${to || '終了不問'}` : '';
  return range ? `対応歴_${range}_${stamp}.csv` : `対応歴_${stamp}.csv`;
}
