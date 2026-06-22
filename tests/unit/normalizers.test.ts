import { describe, expect, it } from 'vitest';
import {
  normalizePhone,
  parseAmount,
  parseBool,
  parseJpDate,
  parseJpDateTime,
  nz,
} from '../../scripts/migrate/lib/normalizers';

describe('nz', () => {
  it('空文字を null に', () => {
    expect(nz('')).toBeNull();
    expect(nz('  ')).toBeNull();
    expect(nz('abc')).toBe('abc');
  });
});

describe('normalizePhone', () => {
  it('数字のみ抽出する', () => {
    const r = normalizePhone('080-3439-6967');
    expect(r.phone).toBe('08034396967');
    expect(r.doNotCall).toBe(false);
  });

  it('架電NG フラグを抽出する(仕様書 §6.3)', () => {
    const r = normalizePhone('08034396967架電NG');
    expect(r.phone).toBe('08034396967');
    expect(r.doNotCall).toBe(true);
    expect(r.originalIfFlagged).toBe('08034396967架電NG');
  });

  it('空文字は null を返す', () => {
    const r = normalizePhone('');
    expect(r.phone).toBeNull();
    expect(r.doNotCall).toBe(false);
  });
});

describe('parseJpDateTime', () => {
  it('スラッシュ形式 を ISO 化', () => {
    const r = parseJpDateTime('2018/7/24 22:06');
    expect(r).toBe('2018-07-24T22:06:00+09:00');
  });

  it('漢字形式を ISO 化', () => {
    const r = parseJpDateTime('2018年7月24日 22時06分');
    expect(r).toBe('2018-07-24T22:06:00+09:00');
  });

  it('日付のみでも ISO 化', () => {
    const r = parseJpDateTime('2020/01/01');
    expect(r).toBe('2020-01-01T00:00:00+09:00');
  });

  it('不正な日付は null', () => {
    expect(parseJpDateTime('not-a-date')).toBeNull();
    expect(parseJpDateTime('')).toBeNull();
    expect(parseJpDateTime(null)).toBeNull();
  });
});

describe('parseJpDate', () => {
  it('YYYY-MM-DD 形式を返す', () => {
    expect(parseJpDate('2018/7/24 22:06')).toBe('2018-07-24');
  });
});

describe('parseAmount', () => {
  it('カンマ・円記号を除去して数値化', () => {
    expect(parseAmount('1,000,000円')).toBe(1000000);
    expect(parseAmount('¥500')).toBe(500);
    expect(parseAmount('')).toBeNull();
  });
});

describe('parseBool', () => {
  it('日本語の真値を解釈', () => {
    expect(parseBool('はい')).toBe(true);
    expect(parseBool('有')).toBe(true);
    expect(parseBool('○')).toBe(true);
    expect(parseBool('いいえ')).toBe(false);
    expect(parseBool('')).toBe(false);
  });
});
