import { describe, expect, it } from 'vitest';
import {
  normalizeApplicationId,
  normalizeInquiryId,
  normalizeMemberId,
} from '../../scripts/migrate/lib/id_normalizers';

describe('normalizeMemberId(K-XXXXXXX)', () => {
  it('既に正規形ならそのまま', () => {
    expect(normalizeMemberId('K-0012345')).toBe('K-0012345');
  });

  it('ハイフンなしを正規化', () => {
    expect(normalizeMemberId('K0012345')).toBe('K-0012345');
  });

  it('短い番号をゼロ埋め', () => {
    expect(normalizeMemberId('K-12345')).toBe('K-0012345');
    expect(normalizeMemberId('12345')).toBe('K-0012345');
  });

  it('小文字も大文字化', () => {
    expect(normalizeMemberId('k-12345')).toBe('K-0012345');
  });

  it('null/空文字は null', () => {
    expect(normalizeMemberId(null)).toBeNull();
    expect(normalizeMemberId('')).toBeNull();
    expect(normalizeMemberId('   ')).toBeNull();
  });

  it('数字を含まなければ null', () => {
    expect(normalizeMemberId('K-')).toBeNull();
    expect(normalizeMemberId('abc')).toBeNull();
  });
});

describe('normalizeApplicationId(M-XXXXXXX)', () => {
  it('M-プレフィックス付与', () => {
    expect(normalizeApplicationId('123')).toBe('M-0000123');
    expect(normalizeApplicationId('M-1')).toBe('M-0000001');
    expect(normalizeApplicationId('M1234567')).toBe('M-1234567');
  });
});

describe('normalizeInquiryId(TA-XXXXXXX)', () => {
  it('TA-プレフィックス付与', () => {
    expect(normalizeInquiryId('TA-1')).toBe('TA-0000001');
    expect(normalizeInquiryId('TA0000123')).toBe('TA-0000123');
    expect(normalizeInquiryId('123')).toBe('TA-0000123');
  });

  it('既に正規形ならそのまま', () => {
    expect(normalizeInquiryId('TA-0012345')).toBe('TA-0012345');
  });
});
