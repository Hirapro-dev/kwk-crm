import { convertLegacyBondRow, normalizeRedemptionMonth } from '@/lib/domain/legacy_bonds_pure';
import { IMPORT_OBJECTS } from '@/lib/import/schema';
import { describe, expect, it } from 'vitest';

/**
 * 旧社債管理の取込(CLAUDE.md §5.13c)。
 * 意図: 会員・申込・案件は「実在するものだけ紐付け、原文は保持」。存在しない ID で FK エラーにしない。
 */
const fields = IMPORT_OBJECTS.legacy_bonds?.fields ?? [];
const ctx = {
  validMemberIds: new Set(['K-000000101']),
  validApplicationIds: new Set(['M-000006750']),
  projectIdByName: new Map([['旧社債', 'T-000000003']]),
};
const base = {
  旧社債管理ID: 'KS-000000001',
  会員ID: 'K-000000101',
  会員氏名: 'テスト 太郎',
  申込ID: 'M-000006750',
  案件: '旧社債',
  社債名: 'テスト社債',
  入金額: '5400000',
  償還対象月: '2025/08',
  償還金額: '55818088',
  前回継続元金: '49858613',
  前回継続年数: '1',
  '前回継続利息（年）': '15',
  利息: '7478791',
  源泉税: '1519316',
  今回の結果: '回答待ち',
  契約書送付日: '2025/09/22',
  一部継続金額: '',
  一部償還金額: '',
  銀行情報: 'テスト銀行',
};

describe('convertLegacyBondRow', () => {
  it('列を型変換し、会員・申込・案件を紐付ける', () => {
    const r = convertLegacyBondRow(base, fields, ctx);
    expect(r.error).toBeUndefined();
    expect(r.record).toMatchObject({
      id: 'KS-000000001',
      member_id: 'K-000000101',
      application_no: 'M-000006750',
      application_id: 'M-000006750',
      project_name: '旧社債',
      project_id: 'T-000000003',
      payment_amount: 5400000,
      redemption_month: '2025/08',
      prev_years: 1,
      prev_interest_rate: 15,
      contract_sent_date: '2025-09-22',
      partial_continue_amount: null,
    });
  });
  it('存在しない会員・申込・案件は FK を null にし、原文は残す', () => {
    const r = convertLegacyBondRow(
      { ...base, 会員ID: 'K-999999999', 申込ID: 'M-999999999', 案件: '未知の案件' },
      fields,
      ctx,
    );
    expect(r.record).toMatchObject({
      member_id: null,
      application_no: 'M-999999999',
      application_id: null,
      project_name: '未知の案件',
      project_id: null,
    });
  });
  it('ID が空、数値が不正な行はエラー', () => {
    expect(convertLegacyBondRow({ ...base, 旧社債管理ID: '' }, fields, ctx).error).toContain(
      '旧社債管理ID',
    );
    expect(convertLegacyBondRow({ ...base, 入金額: 'abc' }, fields, ctx).error).toContain('入金額');
  });
});

// 意図: 償還対象月は "YYYY/MM" の文字列で持つため、月のフィルタは同じ形にそろえてから文字列で比較する
describe('normalizeRedemptionMonth', () => {
  it('"2025-08" / "2025/8" を "2025/08" にする', () => {
    expect(normalizeRedemptionMonth('2025-08')).toBe('2025/08');
    expect(normalizeRedemptionMonth('2025/8')).toBe('2025/08');
  });
  it('空・不正な値・13 月は null', () => {
    expect(normalizeRedemptionMonth('')).toBeNull();
    expect(normalizeRedemptionMonth('2025')).toBeNull();
    expect(normalizeRedemptionMonth('2025-13')).toBeNull();
  });
});
