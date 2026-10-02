/**
 * 申込の新規登録(申込一覧の「新規登録」。CLAUDE.md §5.6 / §8.1)の入力チェック。サーバー依存なし(テスト用に分離)。
 * 案件 ID は文字列(T-000000000 形式。migration 09 で serial から変更済み)。2026-10-01 まで数値として検証しており、
 * どの案件を選んでも「Expected number, received nan」で登録できなかった。
 */

import { z } from 'zod';
import { APP_STATUSES, FLOW_TYPES, INTEREST_TYPES } from './applications_constants';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付は YYYY-MM-DD 形式で指定してください');
const optionalDate = z.union([dateStr, z.literal(''), z.null(), z.undefined()]);
const optionalAmount = z.union([z.number().finite().nonnegative(), z.null(), z.undefined()]);

/** 備考の上限文字数 */
export const APPLICATION_REMARKS_MAX = 2000;

export const CreateApplicationSchema = z.object({
  memberId: z.string().regex(/^K-\d{9}$/, '会員を選択してください'),
  projectId: z.string().regex(/^T-\d{9}$/, '案件を選択してください'),
  applicationDate: dateStr,
  status: z.enum(APP_STATUSES as [string, ...string[]]),
  flowType: z.union([
    z.enum(FLOW_TYPES as [string, ...string[]]),
    z.literal(''),
    z.null(),
    z.undefined(),
  ]),
  acquirerId: z.union([z.string().uuid(), z.literal(''), z.null(), z.undefined()]),
  contractSentDate: optionalDate,
  /** 利息種別(月利 / 年利 / 契約期間内。migration 121) */
  interestType: z.union([
    z.enum(INTEREST_TYPES as [string, ...string[]]),
    z.literal(''),
    z.null(),
    z.undefined(),
  ]),
  /** 利息(%)。既存の円金利 yen_interest とは別の列 interest(migration 107) */
  interest: optionalAmount,
  /** 起算日(契約期間の開始)。日付のみ(2026-10-01 に時刻の入力をやめた)。日本時間のその日の 0 時として保存する */
  startDate: optionalDate,
  contractEndDate: optionalDate,
  paymentDate: optionalDate,
  paymentAmount: optionalAmount,
  contractPeriod: z.union([z.string().max(50), z.null(), z.undefined()]),
  /** 備考(複数行)。extra の「備考」に入れる(2026-10-01) */
  remarks: z.union([
    z
      .string()
      .max(APPLICATION_REMARKS_MAX, `備考は ${APPLICATION_REMARKS_MAX} 文字以内で入力してください`),
    z.null(),
    z.undefined(),
  ]),
});

export type CreateApplicationInput = z.infer<typeof CreateApplicationSchema>;

/** 起算日(YYYY-MM-DD)→ 日本時間のその日 0 時の UTC ISO。空なら null */
export function startDateToTimestamp(date: string | null | undefined): string | null {
  if (!date) return null;
  return new Date(`${date}T00:00:00+09:00`).toISOString();
}
