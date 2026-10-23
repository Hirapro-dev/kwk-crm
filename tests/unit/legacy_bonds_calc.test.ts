/**
 * 旧社債管理の計算・継続(CLAUDE.md §5.13c「編集・自動計算・次の期の自動作成」。migration 130)のテスト。
 * 意図: 担当者が確認した Salesforce の運用どおりに計算する(本番 46 件すべてで一致を確認済みの式)。
 *   - 利息は単利・1 円未満切り捨て、源泉税は 20.315%(海外法人名義は 0 円)、償還金額は税引き後
 *   - 継続すると次の期の元金 = 償還金額(一部継続なら 償還金額 − 一部償還金額)、満期は 年数 + 1 か月 後
 *   - 次の期を作った行は金額・結果を変えさせない(次の期の元金と食い違うため)
 * 金額は架空の値。
 */
import {
  LEGACY_BOND_RATES,
  addMonthsToYm,
  buildLegacyBondPatch,
  computeLegacyBondAmounts,
  legacyBondAttention,
  nextRedemptionMonth,
  planNextLegacyBond,
} from '@/lib/domain/legacy_bonds_calc';
import { describe, expect, it } from 'vitest';

describe('computeLegacyBondAmounts', () => {
  it('利息は単利・切り捨て、源泉税は 20.315% 切り捨て、償還金額は 元金 + 利息 − 源泉税', () => {
    // 1,234,567 × 15% × 1 年 = 185,185.05 → 185,185 / 185,185 × 0.20315 = 37,620.33… → 37,620
    expect(
      computeLegacyBondAmounts({ principal: 1_234_567, years: 1, ratePercent: 15, exempt: false }),
    ).toEqual({
      interest: 185_185,
      withholdingTax: 37_620,
      redemptionAmount: 1_234_567 + 185_185 - 37_620,
    });
  });
  it('複数年は年数を掛ける(単利。複利にしない)', () => {
    const r = computeLegacyBondAmounts({
      principal: 1_000_000,
      years: 3,
      ratePercent: 25,
      exempt: false,
    });
    expect(r.interest).toBe(750_000);
  });
  it('海外法人名義(源泉徴収なし)は源泉税 0 円', () => {
    const r = computeLegacyBondAmounts({
      principal: 1_000_000,
      years: 1,
      ratePercent: 15,
      exempt: true,
    });
    expect(r).toEqual({ interest: 150_000, withholdingTax: 0, redemptionAmount: 1_150_000 });
  });
  it('小数の利率でも浮動小数の誤差で 1 円ずれない', () => {
    // 0.1 刻みの利率でも整数で計算する
    expect(
      computeLegacyBondAmounts({ principal: 3_000_000, years: 1, ratePercent: 14.3, exempt: true })
        .interest,
    ).toBe(429_000);
  });
});

describe('継続年数と利率', () => {
  it('担当者確認済みの表(1 年 15% / 2 年 20% / 3 年 25% / 5 年 30% / 8 年 35%)', () => {
    expect(LEGACY_BOND_RATES).toEqual({ 1: 15, 2: 20, 3: 25, 5: 30, 8: 35 });
  });
});

describe('満期月', () => {
  it('月の足し算は年をまたぐ', () => {
    expect(addMonthsToYm('2025/12', 1)).toBe('2026/01');
    expect(addMonthsToYm('2026/11', 14)).toBe('2028/01');
  });
  it('次の満期は 今回の月 + 年数 + 1 か月(満期月の翌月から新しい期間が始まる)', () => {
    expect(nextRedemptionMonth('2025/10', 1)).toBe('2026/11');
    expect(nextRedemptionMonth('2025/12', 3)).toBe('2029/01');
  });
  it('形式が違う月は null', () => {
    expect(addMonthsToYm('2025-10', 1)).toBeNull();
    expect(addMonthsToYm('2025/13', 1)).toBeNull();
  });
});

const base = {
  id: 'KS-000000999',
  member_id: 'K-000000001',
  member_name: '架空 太郎',
  application_no: 'M-000000001',
  application_id: 'M-000000001',
  project_name: '旧社債',
  project_id: 'T-000000003',
  bond_name: '架空社債',
  payment_amount: 1_000_000,
  redemption_month: '2026/11',
  redemption_amount: 1_119_528,
  prev_principal: 1_000_000,
  prev_years: 1,
  prev_interest_rate: 15,
  interest: 150_000,
  withholding_tax: 30_472,
  result: '全額継続' as string | null,
  contract_sent_date: null,
  partial_continue_amount: null as number | null,
  partial_redemption_amount: null as number | null,
  bank_info: '架空銀行',
  withholding_exempt: false,
  next_bond_id: null as string | null,
};

describe('planNextLegacyBond(次の期の行)', () => {
  it('全額継続: 元金 = 償還金額、満期 = 年数 + 1 か月後、利率は表、金額は式で計算、結果は空', () => {
    const r = planNextLegacyBond(base, 3);
    expect(r.error).toBeUndefined();
    const p = 1_119_528;
    const calc = computeLegacyBondAmounts({
      principal: p,
      years: 3,
      ratePercent: 25,
      exempt: false,
    });
    expect(r.row).toMatchObject({
      member_id: 'K-000000001',
      application_id: 'M-000000001',
      bond_name: '架空社債',
      payment_amount: 1_000_000,
      bank_info: '架空銀行',
      redemption_month: '2029/12',
      prev_principal: p,
      prev_years: 3,
      prev_interest_rate: 25,
      interest: calc.interest,
      withholding_tax: calc.withholdingTax,
      redemption_amount: calc.redemptionAmount,
      result: null,
      withholding_exempt: false,
    });
  });
  it('一部継続: 元金 = 一部継続金額(償還金額 − 一部償還金額)', () => {
    const r = planNextLegacyBond(
      {
        ...base,
        result: '一部継続',
        partial_redemption_amount: 119_528,
        partial_continue_amount: 1_000_000,
      },
      1,
    );
    expect(r.row?.prev_principal).toBe(1_000_000);
  });
  it('源泉徴収なしは次の期に引き継ぐ', () => {
    const r = planNextLegacyBond({ ...base, withholding_exempt: true }, 1);
    expect(r.row?.withholding_exempt).toBe(true);
    expect(r.row?.withholding_tax).toBe(0);
  });
  it('継続でない・作成済み・表に無い年数は作らない', () => {
    expect(planNextLegacyBond({ ...base, result: '回答待ち' }, 1).error).toBeTruthy();
    expect(planNextLegacyBond({ ...base, next_bond_id: 'KS-001000000' }, 1).error).toBeTruthy();
    expect(planNextLegacyBond(base, 4).error).toBeTruthy();
    expect(planNextLegacyBond({ ...base, redemption_amount: null }, 1).error).toBeTruthy();
  });
});

describe('buildLegacyBondPatch(編集の保存)', () => {
  const input = {
    result: '回答待ち',
    prevPrincipal: '2000000',
    prevYears: '2',
    prevInterestRate: '20',
    withholdingExempt: false,
    partialRedemptionAmount: '',
    contractSentDate: '',
    bankInfo: '架空銀行',
  };
  const fresh = { ...base, result: null, next_bond_id: null };
  it('元金・年数・利率から利息・源泉税・償還金額を計算し直す', () => {
    const r = buildLegacyBondPatch(fresh, input);
    const calc = computeLegacyBondAmounts({
      principal: 2_000_000,
      years: 2,
      ratePercent: 20,
      exempt: false,
    });
    expect(r.patch).toMatchObject({
      result: '回答待ち',
      prev_principal: 2_000_000,
      interest: calc.interest,
      withholding_tax: calc.withholdingTax,
      redemption_amount: calc.redemptionAmount,
      partial_continue_amount: null,
      partial_redemption_amount: null,
    });
  });
  it('一部継続は一部償還金額が必須で、一部継続金額 = 償還金額 − 一部償還金額', () => {
    expect(buildLegacyBondPatch(fresh, { ...input, result: '一部継続' }).error).toBeTruthy();
    const r = buildLegacyBondPatch(fresh, {
      ...input,
      result: '一部継続',
      partialRedemptionAmount: '400000',
    });
    const red = computeLegacyBondAmounts({
      principal: 2_000_000,
      years: 2,
      ratePercent: 20,
      exempt: false,
    }).redemptionAmount;
    expect(r.patch?.partial_redemption_amount).toBe(400_000);
    expect(r.patch?.partial_continue_amount).toBe(red - 400_000);
    // 償還金額以上は不可
    expect(
      buildLegacyBondPatch(fresh, {
        ...input,
        result: '一部継続',
        partialRedemptionAmount: String(red),
      }).error,
    ).toBeTruthy();
  });
  it('選択肢に無い結果・不正な数値・日付は保存しない', () => {
    expect(buildLegacyBondPatch(fresh, { ...input, result: '保留' }).error).toBeTruthy();
    expect(buildLegacyBondPatch(fresh, { ...input, prevYears: '1.5' }).error).toBeTruthy();
    expect(buildLegacyBondPatch(fresh, { ...input, prevPrincipal: '-1' }).error).toBeTruthy();
    expect(
      buildLegacyBondPatch(fresh, { ...input, contractSentDate: '2026/10/01' }).error,
    ).toBeTruthy();
  });
  it('結果を空にもできる(満期前)。契約書送付日・銀行情報はそのまま保存', () => {
    const r = buildLegacyBondPatch(fresh, { ...input, result: '', contractSentDate: '2026-10-01' });
    expect(r.patch?.result).toBeNull();
    expect(r.patch?.contract_sent_date).toBe('2026-10-01');
  });
  it('次の期を作成済みの行は、金額・結果・源泉徴収なしを変えさせない(契約書送付日・銀行情報は変えられる)', () => {
    const linked = { ...base, next_bond_id: 'KS-001000000' };
    const same = {
      result: '全額継続',
      prevPrincipal: '1000000',
      prevYears: '1',
      prevInterestRate: '15',
      withholdingExempt: false,
      partialRedemptionAmount: '',
      contractSentDate: '2026-10-01',
      bankInfo: '別の銀行',
    };
    expect(buildLegacyBondPatch(linked, same).error).toBeUndefined();
    expect(buildLegacyBondPatch(linked, { ...same, prevPrincipal: '1000001' }).error).toBeTruthy();
    expect(buildLegacyBondPatch(linked, { ...same, result: '全額償還' }).error).toBeTruthy();
  });
});

describe('legacyBondAttention(一覧で目立たせる)', () => {
  it('満期を過ぎて回答待ち・未入力は「期限切れ」', () => {
    expect(
      legacyBondAttention({ redemption_month: '2026/09', result: '回答待ち' }, '2026/10'),
    ).toBe('overdue');
    expect(legacyBondAttention({ redemption_month: '2026/09', result: null }, '2026/10')).toBe(
      'overdue',
    );
    expect(
      legacyBondAttention({ redemption_month: '2026/09', result: '回答待ち（未）' }, '2026/10'),
    ).toBe('overdue');
  });
  it('今月から 2 か月以内の満期で、回答が決まっていないものは「間近」', () => {
    expect(legacyBondAttention({ redemption_month: '2026/10', result: null }, '2026/10')).toBe(
      'soon',
    );
    expect(
      legacyBondAttention({ redemption_month: '2026/12', result: '回答待ち' }, '2026/10'),
    ).toBe('soon');
    expect(
      legacyBondAttention({ redemption_month: '2027/01', result: null }, '2026/10'),
    ).toBeNull();
  });
  it('回答が決まったもの(継続・償還)は目立たせない', () => {
    expect(
      legacyBondAttention({ redemption_month: '2026/09', result: '全額継続' }, '2026/10'),
    ).toBeNull();
    expect(
      legacyBondAttention({ redemption_month: '2026/10', result: '全額償還' }, '2026/10'),
    ).toBeNull();
  });
});
