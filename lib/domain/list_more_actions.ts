'use server';

/**
 * 一覧の無限スクロール用「次ページ取得」Server Actions。
 * 既存の list 関数(フィルタ/ソート対応)を pageSize=50 で呼び、行だけ返す。
 */

import { listActivities } from './activities';
import { listApplications } from './applications';
import { listArticleReactions } from './article_reactions';
import { listInquiries } from './inquiries';
import { LIST_PAGE_SIZE } from './list_constants';
import { listLpEntries } from './lp';
import { listMailThreads } from './mail';
import type { MailCategory, MailStatus } from './mail_types';
import { listMembers } from './members';
import { listWithdrawalChildren, listWithdrawalParents } from './withdrawals';

export async function loadMoreMembers(
  params: { q?: string; ownerId?: string; sort?: string; dir?: 'asc' | 'desc' },
  page: number,
) {
  const r = await listMembers({ ...params, page, pageSize: LIST_PAGE_SIZE });
  return r.rows;
}

export async function loadMoreInquiries(
  params: {
    q?: string;
    formId?: number;
    unassigned?: boolean;
    mailImported?: boolean;
    sort?: string;
    dir?: 'asc' | 'desc';
  },
  page: number,
) {
  const r = await listInquiries({ ...params, page, pageSize: LIST_PAGE_SIZE });
  return r.rows;
}

export async function loadMoreApplications(
  params: {
    q?: string;
    projectId?: number;
    status?: string;
    sort?: string;
    dir?: 'asc' | 'desc';
  },
  page: number,
) {
  // status は AppStatus 型だが呼び出し側でホワイトリスト済みのため緩く渡す
  const r = await listApplications({
    ...(params as Record<string, unknown>),
    page,
    pageSize: LIST_PAGE_SIZE,
  });
  return r.rows;
}

export async function loadMoreArticleReactions(
  params: { q?: string; sort?: string; dir?: 'asc' | 'desc' },
  page: number,
) {
  const r = await listArticleReactions({ ...params, page, pageSize: LIST_PAGE_SIZE });
  return r.rows;
}

export async function loadMoreWithdrawalParents(
  params: { q?: string; sort?: string; dir?: 'asc' | 'desc' },
  page: number,
) {
  const r = await listWithdrawalParents({ ...params, page, pageSize: LIST_PAGE_SIZE });
  return r.rows;
}

export async function loadMoreWithdrawalChildren(
  params: { q?: string; sort?: string; dir?: 'asc' | 'desc' },
  page: number,
) {
  const r = await listWithdrawalChildren({ ...params, page, pageSize: LIST_PAGE_SIZE });
  return r.rows;
}

export async function loadMoreLpEntries(
  params: {
    q?: string;
    formName?: string;
    mailImported?: boolean;
    sort?: string;
    dir?: 'asc' | 'desc';
  },
  page: number,
) {
  const r = await listLpEntries({ ...params, page, pageSize: LIST_PAGE_SIZE });
  return r.rows;
}

export async function loadMoreMailThreads(
  params: {
    q?: string;
    status?: MailStatus;
    category?: MailCategory;
    assigneeId?: string;
    mailBoxId?: number;
    mailBoxIds?: number[];
    unreadOnly?: boolean;
    importCandidate?: boolean;
  },
  page: number,
) {
  const r = await listMailThreads({ ...params, page, pageSize: LIST_PAGE_SIZE, strict: true });
  return r.rows;
}

/**
 * 会員詳細の対応歴を絞り込んで読み直す(接触種別・状態・期間)。件数付きで返す。
 * 絞り込みを変えたときの先頭ページと、その続きの両方で使う。
 */
export async function loadActivitiesPage(
  params: {
    memberId?: string;
    ownerId?: string;
    dBunrui?: string;
    dBunruiIn?: string[];
    mBunrui?: string;
    sBunrui?: string;
    from?: string;
    to?: string;
  },
  page: number,
) {
  const r = await listActivities({ ...params, page, pageSize: LIST_PAGE_SIZE });
  return { rows: r.rows, total: r.total };
}

export async function loadMoreActivities(
  params: {
    memberId?: string;
    ownerId?: string;
    dBunrui?: string;
    mBunrui?: string;
    sBunrui?: string;
    from?: string;
    to?: string;
  },
  page: number,
) {
  const r = await listActivities({ ...params, page, pageSize: LIST_PAGE_SIZE });
  return r.rows;
}
