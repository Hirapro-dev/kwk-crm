/**
 * メーラーの件数表(CLAUDE.md §5.15「件数表」/ migration 136)から件数を出す純粋関数。
 *
 * タブの件数・一覧の総件数・取込候補の件数は、これまで表示のたびに mail_threads をその場で数えていた
 * (lib/domain/mail.ts の applyThreadFilters と同じ絞り込み)。件数表は 受信箱 × 分類 × 状態 × 既読 × 取込候補
 * ごとの件数を持つので、その区分で表せる絞り込みはここで合計して出す。担当・会員・検索語は区分に無いため、
 * そのときは呼び出し側がその場で数える(canCountFromGroups)。
 */

import type { MailCategory, MailStatus } from './mail_types';

/** mail_thread_count_groups() の 1 行(受信箱で絞った後の、分類・状態・既読・取込候補ごとの件数) */
export interface MailThreadCountGroup {
  category: string;
  status: string;
  is_read: boolean;
  is_import_candidate: boolean;
  n: number;
}

/** 件数を出すときの絞り込み(一覧・件数の ThreadFilterParams のうち件数に関わるもの) */
export interface MailThreadCountFilter {
  q?: string;
  status?: MailStatus | readonly MailStatus[];
  category?: MailCategory;
  assigneeId?: string;
  mailBoxId?: number;
  mailBoxIds?: number[];
  unreadOnly?: boolean;
  memberId?: string;
  importCandidate?: boolean;
}

/** 件数表から数えられる絞り込みか(担当・会員・検索語は件数表の区分に無い) */
export function canCountFromGroups(f: MailThreadCountFilter): boolean {
  return !f.q?.trim() && !f.assigneeId && !f.memberId;
}

/**
 * 件数表を読むときの受信箱の指定。null = 全受信箱。
 * 1 つの受信箱と受信箱群の両方があるときは、その場で数えるときと同じく重なりだけ。
 */
export function countBoxIds(
  f: Pick<MailThreadCountFilter, 'mailBoxId' | 'mailBoxIds'>,
): number[] | null {
  if (f.mailBoxIds) {
    const ids = [...new Set(f.mailBoxIds)].sort((a, b) => a - b);
    return f.mailBoxId ? ids.filter((id) => id === f.mailBoxId) : ids;
  }
  return f.mailBoxId ? [f.mailBoxId] : null;
}

/** 受信箱で絞った件数表の行から、状態・分類・未読・取込候補の条件に合う件数を合計する */
export function countFromGroups(
  groups: readonly MailThreadCountGroup[],
  f: MailThreadCountFilter,
): number {
  const statuses =
    f.status === undefined ? null : Array.isArray(f.status) ? f.status : [f.status as MailStatus];
  let total = 0;
  for (const r of groups) {
    if (statuses && !(statuses as readonly string[]).includes(r.status)) continue;
    if (f.category && r.category !== f.category) continue;
    if (f.unreadOnly && r.is_read) continue;
    if (f.importCandidate && !r.is_import_candidate) continue;
    total += Number(r.n) || 0;
  }
  return total;
}
