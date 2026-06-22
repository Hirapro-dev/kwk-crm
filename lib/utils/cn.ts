import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Tailwind クラス名を結合・重複解決するユーティリティ。
 * 例: cn('p-2', condition && 'p-4') -> 'p-4'
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
