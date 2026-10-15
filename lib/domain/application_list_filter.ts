/**
 * 申込の絞り込み条件(URL クエリ)の解釈。申込一覧(/applications)とサマリの入金タブ(/summary)で使う。
 * client-safe な純粋関数のみ(DB には触らない)。
 *
 * 2026-10-16 修正: 案件ID は `T-000000003` のような文字列(projects.id は text。仕様書 §5.5)なのに、
 * 数値として解釈していたため、案件を選んでも絞り込まれず全件が出ていた。
 */

import { ALL_APP_STATUSES, type AppStatus } from './applications_constants';

/** 案件ID として受け付ける形(英数字・ハイフン・下線。T-000000003 / 旧データの数字だけの ID も通す) */
const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * URL の `project` を案件ID に直す。
 * 空・「all」(サマリの「全案件」)・案件ID の形でない値は null(= 案件で絞らない)。
 * 数値には変換しない(T- 形式の ID が NaN になって絞り込みが外れるため)。
 */
export function parseProjectFilterParam(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  if (v === '' || v === 'all') return null;
  return PROJECT_ID_PATTERN.test(v) ? v : null;
}

/**
 * URL の `status` を申込ステータスに直す。
 * 過去の値(完了・未購入・失効)でも絞り込めるよう、DB に入りうる全ステータスで検証する。
 * 一覧に無い値は undefined(= ステータスで絞らない)。
 */
export function parseAppStatusFilterParam(raw: string | null | undefined): AppStatus | undefined {
  const v = (raw ?? '').trim();
  return (ALL_APP_STATUSES as string[]).includes(v) ? (v as AppStatus) : undefined;
}
