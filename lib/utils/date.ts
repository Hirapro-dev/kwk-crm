/**
 * 仕様書 §12.1 に従い、日付表示は `YYYY/MM/DD HH:mm` (日本ロケール) で統一する。
 *
 * date-fns の format() はサーバー(Vercel = UTC)のローカルタイムゾーンで動作するため、
 * すべて Intl.DateTimeFormat に timeZone: 'Asia/Tokyo' を明示し、
 * サーバー・クライアントいずれでも JST 表示を保証する。
 */

const JST_TZ = 'Asia/Tokyo';

function toParts(d: Date, options: Intl.DateTimeFormatOptions): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat('ja-JP', { timeZone: JST_TZ, ...options })
      .formatToParts(d)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  );
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  const p = toParts(d, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}`;
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  const p = toParts(d, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}/${p.month}/${p.day}`;
}

export function formatMonth(date: Date | string | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  const p = toParts(d, { year: 'numeric', month: '2-digit' });
  return `${p.year}/${p.month}`;
}
