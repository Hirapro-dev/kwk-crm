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

describe('coerceValue datetime', () => {
  it('年先頭 + 時刻', () => {
    expect(val('datetime', '2018/7/24 22:06')).toBe('2018-07-24T22:06:00');
  });
  it('米国式 + 時刻', () => {
    expect(val('datetime', '4/11/12 9:5')).toBe('2012-04-11T09:05:00');
  });
});
