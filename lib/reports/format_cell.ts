/**
 * レポートのセル値を表示用文字列に整形する共通関数。
 * テーブル・グラフX軸・グループキーで同じ整形を使い、表示を一致させる。
 */

import { formatDate, formatDateTime } from '@/lib/utils/date';

export function formatReportCell(v: unknown, dataType?: string): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) {
        // UTC 00:00:00 (= JST 09:00) は日付のみ表示(時刻情報なしと判断)
        if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) {
          return formatDate(v);
        }
        return formatDateTime(v);
      }
    }
    // M/D/YY・M/D/YYYY・YYYY/M/D 形式の日付文字列を YYYY/MM/DD に整形。
    // 年を含むパターンのみ対象とし、比率等(例 5/6)は変換しない。
    if (
      dataType !== 'number' &&
      (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(v) || /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(v))
    ) {
      const f = formatDate(v);
      if (f) return f;
    }
    // number 型カラムは文字列で返ってくることがあるためカンマ整形
    if (dataType === 'number' && /^-?\d+(\.\d+)?$/.test(v)) {
      return Number(v).toLocaleString('ja-JP');
    }
    return v;
  }
  if (typeof v === 'number') return Number(v).toLocaleString('ja-JP');
  if (typeof v === 'boolean') return v ? '✓' : '';
  return JSON.stringify(v);
}

/** カテゴリ/グループの表示名(空は "(空白)")。テーブルと同じ整形を使う。 */
export function categoryName(v: unknown, dataType?: string): string {
  if (v === null || v === undefined || v === '') return '(空白)';
  const s = formatReportCell(v, dataType);
  return s === '' ? '(空白)' : s;
}
