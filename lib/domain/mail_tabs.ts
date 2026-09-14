/**
 * メーラー一覧の状態タブ(CLAUDE.md §8.1)。メールディーラーの
 * 「新着 / 返信処理中 / 対応完了 / すべて …」に相当する。
 * タブ → 絞り込み条件(status / category)の対応を1か所に固定し、
 * URL の `?tab=` から決定論的に解決する。
 */

import type { MailCategory, MailStatus } from './mail_types';

export interface MailTab {
  key: string;
  label: string;
  /** undefined = 状態で絞らない */
  status?: MailStatus;
  /** undefined = 分類で絞らない */
  category?: MailCategory;
}

export const MAIL_TABS: readonly MailTab[] = [
  { key: 'new', label: '新着', status: '未対応', category: '通常' },
  { key: 'active', label: '対応中', status: '対応中', category: '通常' },
  { key: 'done', label: '対応完了', status: '完了', category: '通常' },
  { key: 'all', label: 'すべて', category: '通常' },
  { key: 'newsletter', label: 'メルマガ', category: 'メルマガ' },
  { key: 'auto', label: '自動応答', category: '自動応答' },
  { key: 'spam', label: '迷惑メール', category: '迷惑メール' },
] as const;

export const DEFAULT_MAIL_TAB_KEY = 'new';

/** `?tab=` の値からタブを解決する。未知の値・未指定は「新着」 */
export function resolveMailTab(key: string | undefined): MailTab {
  const found = MAIL_TABS.find((t) => t.key === key);
  return found ?? (MAIL_TABS.find((t) => t.key === DEFAULT_MAIL_TAB_KEY) as MailTab);
}

/**
 * タブから一覧の絞り込み(status / category)を決める。
 * フォルダ「取込候補」(migration 82)では状態タブを適用しない
 * (状態・分類を問わず全件を見渡して仕訳するため)。他のフォルダは従来どおり。
 */
export function mailTabFilter(
  tab: MailTab,
  opts: { importCandidate: boolean },
): { status?: MailStatus; category?: MailCategory } {
  if (opts.importCandidate) return {};
  return { status: tab.status, category: tab.category };
}
