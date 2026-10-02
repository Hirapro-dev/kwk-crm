import { buildApplicationPatch, toJstDateTimeLocal } from '@/lib/domain/application_edit';
import { describe, expect, it } from 'vitest';

/**
 * 申込詳細の編集(CLAUDE.md §8.1。admin のみ)。
 * 意図: 画面の文字列入力を、許可した列だけ・正しい型で DB に渡す。不正な値は DB に送る前に止める。
 */
describe('buildApplicationPatch', () => {
  it('数値はカンマを除き、日付はそのまま、起算日は日本時間のその日の 0 時を UTC にする', () => {
    const r = buildApplicationPatch({
      payment_amount: '1,000,000',
      payment_date: '2026-09-30',
      start_datetime: '2026-10-01',
      status: '完了',
      // 区分(flow_type)は 2026-10-02 に項目から外したので無視される
      flow_type: '入金',
      transfer_to: ' 口座A ',
    });
    expect(r).toEqual({
      patch: {
        payment_amount: 1000000,
        payment_date: '2026-09-30',
        start_datetime: '2026-09-30T15:00:00.000Z',
        status: '完了',
        transfer_to: '口座A',
      },
    });
  });
  it('許可していない列は無視する(id・取込の原文・extra など)', () => {
    const r = buildApplicationPatch({
      id: 'M-X',
      acquirer_name_raw: 'x',
      extra: '{}',
      interest: '15',
    });
    expect(r).toEqual({ patch: { interest: 15 } });
  });
  it('過去のステータス(完了など)はそのまま保存でき、契約期間は数字だけにする', () => {
    // 過去の申込は値を変えずに残す(ユーザー決定)。編集で他の項目だけ直しても保存できること
    expect(buildApplicationPatch({ status: '完了', contract_period: '6ヶ月' })).toEqual({
      patch: { status: '完了', contract_period: '6' },
    });
    expect(buildApplicationPatch({ contract_period: '半年' })).toEqual({
      error: '契約期間は月数(数字)で入力してください(半年)',
    });
  });
  it('利息種別は 月利 / 年利 / 契約期間内 だけ。空は未設定(null)', () => {
    // 利息(%)が何の期間あたりの率かを表すため、自由入力の値は DB の CHECK に当たる前に止める(migration 121)
    expect(buildApplicationPatch({ interest_type: '年利' })).toEqual({
      patch: { interest_type: '年利' },
    });
    expect(buildApplicationPatch({ interest_type: '' })).toEqual({
      patch: { interest_type: null },
    });
    expect(buildApplicationPatch({ interest_type: '日利' })).toEqual({
      error: '利息種別が不正です: 日利',
    });
  });
  it('必須項目の空・選択肢外のステータス・不正な数値と日付はエラー', () => {
    expect(buildApplicationPatch({ project_id: '' })).toEqual({ error: '案件は必須です' });
    expect(buildApplicationPatch({ member_id: '' })).toEqual({ error: '会員は必須です' });
    expect('error' in buildApplicationPatch({ status: '保留' })).toBe(true);
    expect('error' in buildApplicationPatch({ payment_amount: 'abc' })).toBe(true);
    expect('error' in buildApplicationPatch({ payment_date: '2026/09/30' })).toBe(true);
  });
});

describe('toJstDateTimeLocal', () => {
  it('UTC の日時を日本時間の datetime-local 表記にする', () => {
    expect(toJstDateTimeLocal('2026-10-01T00:00:00+00:00')).toBe('2026-10-01T09:00');
    expect(toJstDateTimeLocal(null)).toBe('');
  });
});
