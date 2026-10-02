import {
  CreateApplicationSchema,
  normalizeContractPeriod,
  startDateToTimestamp,
} from '@/lib/domain/application_create_schema';
import { describe, expect, it } from 'vitest';

/**
 * 申込の新規登録の入力チェック(CLAUDE.md §8.1)。
 * 意図: 案件 ID は "T-000000000" 形式の文字列。数値として検証していたため、どの案件でも登録できなかった(2026-10-01)。
 */
const base = {
  memberId: 'K-000010293',
  projectId: 'T-000000082',
  applicationDate: '2026-10-01',
  status: '対応中',
};

describe('CreateApplicationSchema', () => {
  it('文字列の案件 ID(T-…)を受け付ける', () => {
    expect(CreateApplicationSchema.safeParse(base).success).toBe(true);
  });
  it('数値や形式の違う案件 ID は「案件を選択してください」', () => {
    const r = CreateApplicationSchema.safeParse({ ...base, projectId: 'NaN' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe('案件を選択してください');
  });
  it('ステータスは 対応中 / 入金 / 出金 / 資金移動 だけ。過去の値(完了・未購入・失効)は新規では選べない', () => {
    for (const st of ['対応中', '入金', '出金', '資金移動']) {
      expect(CreateApplicationSchema.safeParse({ ...base, status: st }).success).toBe(true);
    }
    for (const st of ['完了', '未購入', '失効']) {
      expect(CreateApplicationSchema.safeParse({ ...base, status: st }).success).toBe(false);
    }
  });
  it('契約期間は月数。「8ヶ月」「８か月」も数字だけにする(表示名が「契約期間（ヶ月）」のため)', () => {
    expect(normalizeContractPeriod('8ヶ月')).toBe('8');
    expect(normalizeContractPeriod('８か月')).toBe('8');
    expect(normalizeContractPeriod(' 12 ')).toBe('12');
    expect(normalizeContractPeriod('')).toBeNull();
    expect(normalizeContractPeriod('半年')).toBeUndefined();
    expect(CreateApplicationSchema.safeParse({ ...base, contractPeriod: '半年' }).success).toBe(
      false,
    );
  });
  it('利息種別は選択肢の 3 つか未設定だけ', () => {
    for (const t of ['月利', '年利', '契約期間内', '', null]) {
      expect(CreateApplicationSchema.safeParse({ ...base, interestType: t }).success).toBe(true);
    }
    expect(CreateApplicationSchema.safeParse({ ...base, interestType: '日利' }).success).toBe(
      false,
    );
  });
  it('起算日は日付だけ、備考は 2,000 文字まで', () => {
    expect(
      CreateApplicationSchema.safeParse({ ...base, startDate: '2026-09-30', remarks: '備考です' })
        .success,
    ).toBe(true);
    expect(
      CreateApplicationSchema.safeParse({ ...base, startDate: '2026-09-30T15:21' }).success,
    ).toBe(false);
    expect(CreateApplicationSchema.safeParse({ ...base, remarks: 'あ'.repeat(2001) }).success).toBe(
      false,
    );
  });
});

describe('startDateToTimestamp', () => {
  it('日本時間のその日 0 時にする', () => {
    expect(startDateToTimestamp('2026-09-30')).toBe('2026-09-29T15:00:00.000Z');
    expect(startDateToTimestamp('')).toBeNull();
  });
});
