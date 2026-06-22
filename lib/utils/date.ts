import { format } from 'date-fns';
import { ja } from 'date-fns/locale';

/**
 * 仕様書 §12.1 に従い、日付表示は `YYYY/MM/DD HH:mm` (日本ロケール) で統一する。
 */

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  return format(d, 'yyyy/MM/dd HH:mm', { locale: ja });
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  return format(d, 'yyyy/MM/dd', { locale: ja });
}

export function formatMonth(date: Date | string | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  return format(d, 'yyyy/MM', { locale: ja });
}
