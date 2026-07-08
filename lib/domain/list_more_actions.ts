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
import { listMembers } from './members';

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
