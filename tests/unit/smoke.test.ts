import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/utils/cn';
import { formatDate } from '@/lib/utils/date';

/**
 * Phase 0 環境構築の動作確認用スモークテスト。
 * CI が緑になることを確認するための最小テスト。
 */
describe('smoke', () => {
  it('cn() がクラス名を結合する', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('formatDate() が YYYY/MM/DD 形式を返す', () => {
    const result = formatDate('2025-05-11T12:34:00Z');
    // タイムゾーン依存を避けるため形式のみチェック
    expect(result).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
  });
});
