import { describe, expect, it } from 'vitest';
import { resolveDateRange } from '@/lib/utils/date_preset';

/**
 * サマリの期間プリセットは日本時間の暦で決める。
 * サーバーの時計は UTC なので、日本時間 0:00〜8:59(UTC では前日)でも
 * 「今日・今月」が日本時間の日付になることを確かめる。
 */
describe('resolveDateRange(日本時間)', () => {
  // 日本時間 2026-11-01 08:30 = UTC 2026-10-31 23:30
  const earlyMorningJst = new Date('2026-10-31T23:30:00Z');

  it('今日は日本時間の日付になる', () => {
    expect(resolveDateRange('today', null, null, earlyMorningJst)).toEqual({
      from: '2026-11-01',
      to: '2026-11-01',
    });
  });

  it('昨日は日本時間の前日になる', () => {
    expect(resolveDateRange('yesterday', null, null, earlyMorningJst)).toEqual({
      from: '2026-10-31',
      to: '2026-10-31',
    });
  });

  it('月初の朝でも今月は日本時間の月になる', () => {
    expect(resolveDateRange('this_month', null, null, earlyMorningJst)).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
    });
  });

  it('先月・直近 3 か月は月をまたいで計算する', () => {
    expect(resolveDateRange('last_month', null, null, earlyMorningJst)).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(resolveDateRange('last_3_months', null, null, earlyMorningJst)).toEqual({
      from: '2026-09-01',
      to: '2026-11-30',
    });
  });

  it('年始の朝でも今年・昨年は日本時間の年になる', () => {
    // 日本時間 2027-01-01 03:00 = UTC 2026-12-31 18:00
    const newYear = new Date('2026-12-31T18:00:00Z');
    expect(resolveDateRange('this_year', null, null, newYear).from).toBe('2027-01-01');
    expect(resolveDateRange('last_year', null, null, newYear).to).toBe('2026-12-31');
  });

  it('期間指定は入力をそのまま返す', () => {
    expect(resolveDateRange('custom', '2026-01-05', '', earlyMorningJst)).toEqual({
      from: '2026-01-05',
      to: null,
    });
  });
});
