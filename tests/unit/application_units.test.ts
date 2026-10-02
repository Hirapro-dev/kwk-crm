import { formatApplicationUnitValue } from '@/lib/domain/application_units';
import { describe, expect, it } from 'vitest';

/**
 * 申込の一覧・詳細の単位表示(2026-10-02)。
 * 意図: 項目名ではなくセルの値に単位を付ける。入力は数字のままなので、表示のときだけ付ける。
 */
describe('formatApplicationUnitValue', () => {
  it('利息は %、契約期間は ヶ月 を付ける', () => {
    expect(formatApplicationUnitValue('interest', 0.01)).toBe('0.01%');
    expect(formatApplicationUnitValue('interest', '30')).toBe('30%');
    expect(formatApplicationUnitValue('contract_period', '4')).toBe('4ヶ月');
    expect(formatApplicationUnitValue('contract_period', 12)).toBe('12ヶ月');
  });
  it('空は -、数字でない古い値はそのまま(単位を重ねない)', () => {
    expect(formatApplicationUnitValue('interest', null)).toBe('-');
    expect(formatApplicationUnitValue('contract_period', '')).toBe('-');
    expect(formatApplicationUnitValue('contract_period', '半年')).toBe('半年');
  });
  it('対象外の項目は null(通常の表示に任せる)', () => {
    expect(formatApplicationUnitValue('payment_amount', 1000)).toBeNull();
  });
});
