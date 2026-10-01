import { canonForCompare, isUnchanged, parseDateTimeAsUtc } from '@/lib/import/diff';
import { describe, expect, it } from 'vitest';

/**
 * 取込の差分判定で、日時の書き方の違いを同じ値として扱う(CLAUDE.md §6.1b。2026-10-01)。
 * 意図: DB は時差なしの日時を UTC として保存し "+00:00" 付きで返す。取込側は時差なしの文字列なので、
 * 時差なしを UTC として読まないと、実行環境(日本時間)によっては毎回「更新」と判定されてしまう。
 */
describe('parseDateTimeAsUtc', () => {
  it('時差の表記が無い日時は UTC として読む(実行環境のタイムゾーンに依存しない)', () => {
    expect(parseDateTimeAsUtc('2023-03-01T00:00:00')).toBe(Date.UTC(2023, 2, 1));
    expect(parseDateTimeAsUtc('2023/3/1 0:00')).toBe(Date.UTC(2023, 2, 1));
    expect(parseDateTimeAsUtc('2023-03-01')).toBe(Date.UTC(2023, 2, 1));
  });
  it('時差の表記があればそれに従う', () => {
    expect(parseDateTimeAsUtc('2023-03-01T00:00:00+00:00')).toBe(Date.UTC(2023, 2, 1));
    expect(parseDateTimeAsUtc('2023-03-01T09:00:00+09:00')).toBe(Date.UTC(2023, 2, 1));
    expect(parseDateTimeAsUtc('2023-03-01T00:00:00Z')).toBe(Date.UTC(2023, 2, 1));
    expect(parseDateTimeAsUtc('2023-03-01T00:00:00.000+0000')).toBe(Date.UTC(2023, 2, 1));
  });
  it('日時でない文字列は null', () => {
    expect(parseDateTimeAsUtc('M-000051829')).toBeNull();
    expect(parseDateTimeAsUtc('12ヶ月')).toBeNull();
  });
});

describe('isUnchanged(日時の表記差)', () => {
  it('DB の "+00:00" 付きと取込の時差なしは同じ値として「変更なし」', () => {
    expect(canonForCompare('2023-03-01T00:00:00')).toBe(
      canonForCompare('2023-03-01T00:00:00+00:00'),
    );
    expect(
      isUnchanged(
        { id: 'M-1', start_datetime: '2023-03-01T00:00:00' },
        { id: 'M-1', start_datetime: '2023-03-01T00:00:00+00:00' },
      ),
    ).toBe(true);
  });
  it('本当に違う日時は「更新」', () => {
    expect(
      isUnchanged(
        { id: 'M-1', start_datetime: '2023-03-02T00:00:00' },
        { id: 'M-1', start_datetime: '2023-03-01T00:00:00+00:00' },
      ),
    ).toBe(false);
  });
});
