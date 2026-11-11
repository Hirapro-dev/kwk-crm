import { describe, expect, it } from 'vitest';
import { coerceValue, isCoerceErr } from '../../lib/import/coerce';

/** 日付/数値の型変換(取込) — 米国式 M/D/YY 含む(CLAUDE.md §6.3) */

function val(type: Parameters<typeof coerceValue>[0], raw: string) {
  const r = coerceValue(type, raw);
  if (isCoerceErr(r)) throw new Error(r.error);
  return r.value;
}

describe('coerceValue date', () => {
  it('年先頭 YYYY/M/D', () => {
    expect(val('date', '2018/7/24')).toBe('2018-07-24');
    expect(val('date', '2018-07-04')).toBe('2018-07-04');
  });

  it('米国式 M/D/YY (2桁年, Excel互換ピボット)', () => {
    expect(val('date', '9/4/68')).toBe('1968-09-04'); // 68→1968
    expect(val('date', '11/14/58')).toBe('1958-11-14');
    expect(val('date', '4/11/12')).toBe('2012-04-11'); // 12→2012
    expect(val('date', '12/19/17')).toBe('2017-12-19');
    expect(val('date', '4/17/18')).toBe('2018-04-17');
  });

  it('米国式 M/D/YYYY (4桁年)', () => {
    expect(val('date', '8/16/1973')).toBe('1973-08-16');
  });

  it('空は null、解釈不能はエラー', () => {
    expect(val('date', '')).toBeNull();
    expect(isCoerceErr(coerceValue('date', 'abc'))).toBe(true);
  });
});

// 意図: Salesforce が書き出す CSV の日時は日本時間。時差を付けずに渡すと DB(UTC)が UTC として保存し、
// 画面では 9 時間ずれて表示される(スクリプト取込は +09:00 を付けており、画面取込とずれていた)
describe('coerceValue datetime(CSV の日時は日本時間として読む)', () => {
  it('年先頭 + 時刻は +09:00 を付ける', () => {
    expect(val('datetime', '2018/7/24 22:06')).toBe('2018-07-24T22:06:00+09:00');
  });
  it('米国式 + 時刻も +09:00 を付ける', () => {
    expect(val('datetime', '4/11/12 9:5')).toBe('2012-04-11T09:05:00+09:00');
  });
  it('日付だけのときは日本時間のその日の 0 時', () => {
    expect(val('datetime', '2026/9/15')).toBe('2026-09-15T00:00:00+09:00');
  });
  it('秒まであるときは秒も残す', () => {
    expect(val('datetime', '2026/09/16 15:07:50')).toBe('2026-09-16T15:07:50+09:00');
  });
});
