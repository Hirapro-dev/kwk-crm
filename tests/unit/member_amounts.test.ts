import { computeMemberAmounts } from '@/lib/domain/member_amounts';
import { describe, expect, it } from 'vitest';

/**
 * 会員の案件別 利用額・出金額と累計入金額の自動計算(CLAUDE.md §5.4。2026-10-01)。
 * 意図: Salesforce の値を 99% 以上再現できた式で固定する(資金移動で入ってきた額を利用額と累計入金額に含める)。
 */
const keys = new Map([
  ['T-1', 'ASEC'],
  ['T-2', 'C.I.O（Original）'],
]);

describe('computeMemberAmounts', () => {
  it('ステータス「入金」は旧名「完了」と同じく入金済みとして数える(2026-10-02 改名。過去の申込は「完了」のまま)', () => {
    const out = computeMemberAmounts(
      [
        {
          project_id: 'T-1',
          status: '入金',
          payment_amount: 1000000,
          withdrawal_amount: null,
          transfer_amount: 200000,
        },
        {
          project_id: 'T-1',
          status: '完了',
          payment_amount: 500000,
          withdrawal_amount: null,
          transfer_amount: null,
        },
      ],
      keys,
      {},
    );
    expect(out).toEqual({ ASEC利用額: '1700000', 累計入金額: '1700000' });
  });
  it('利用額 = 完了の入金額 + 資金移動額、出金額 = 出金の出金額、累計入金額 = 入金額 + 出金額 + 完了の資金移動額', () => {
    const out = computeMemberAmounts(
      [
        {
          project_id: 'T-1',
          status: '完了',
          payment_amount: 1000000,
          withdrawal_amount: null,
          transfer_amount: null,
        },
        {
          project_id: 'T-1',
          status: '完了',
          payment_amount: null,
          withdrawal_amount: null,
          transfer_amount: '500000',
        },
        {
          project_id: 'T-2',
          status: '出金',
          payment_amount: null,
          withdrawal_amount: 300000,
          transfer_amount: null,
        },
        // 未購入・資金移動ステータスの行は利用額に入れない(資金移動ステータスの資金移動額は「出ていった額」)
        {
          project_id: 'T-1',
          status: '未購入',
          payment_amount: null,
          withdrawal_amount: null,
          transfer_amount: null,
        },
        {
          project_id: 'T-2',
          status: '資金移動',
          payment_amount: null,
          withdrawal_amount: null,
          transfer_amount: 200000,
        },
      ],
      keys,
      { 会員歴: '5年', 'C.I.Oシリーズ合計利用額': '999' },
    );
    expect(out).toEqual({
      会員歴: '5年',
      // 合計系は対象外(そのまま)
      'C.I.Oシリーズ合計利用額': '999',
      ASEC利用額: '1500000',
      'C.I.O（Original）出金額': '300000',
      累計入金額: '1800000',
    });
  });

  it('既にあるキーで計算結果が 0 のものは "0" にし、無いキーは作らない', () => {
    const out = computeMemberAmounts([], keys, { ASEC利用額: '700000', 累計入金額: '700000' });
    expect(out).toEqual({ ASEC利用額: '0', 累計入金額: '0' });
    expect(computeMemberAmounts([], keys, {})).toEqual({});
  });

  it('小数部が 0 の金額は整数表記にする(CSV の値と同じ形)', () => {
    const out = computeMemberAmounts(
      [
        {
          project_id: 'T-1',
          status: '完了',
          payment_amount: '3052047.00',
          withdrawal_amount: null,
          transfer_amount: null,
        },
      ],
      keys,
      {},
    );
    expect(out.ASEC利用額).toBe('3052047');
  });
});
