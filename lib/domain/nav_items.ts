/**
 * メニューバー(ナビゲーション)項目の取得 (CLAUDE.md §5.10b)
 *
 * 上部横タブ(TabsNav)の表示順・表示有無を nav_items テーブルから取得する。
 * migration 14 未適用・テーブル空・エラー時は DEFAULT_NAV_ITEMS にフォールバックし、
 * メニューバーが壊れないようにする。
 */

import type { TabItem } from '@/components/layout/TabsNav';
import { createClient } from '@/lib/supabase/server';

export interface NavItem {
  id: string;
  label: string;
  href: string;
  match_prefix: boolean;
  sort_order: number;
  is_visible: boolean;
  /** 親タブID。指定時は親タブのホバープルダウン内に表示 (migration 65) */
  parent_id?: string | null;
  /** 表示を許可するロール群。null/undefined は全ロール表示 (migration 65) */
  visible_roles?: string[] | null;
}

/** migration 14 のシードと一致させる既定値(フォールバック用) */
export const DEFAULT_NAV_ITEMS: NavItem[] = [
  {
    id: 'dashboard',
    label: 'ダッシュボード',
    href: '/',
    match_prefix: false,
    sort_order: 10,
    is_visible: true,
  },
  {
    id: 'members',
    label: '顧客情報',
    href: '/members',
    match_prefix: true,
    sort_order: 20,
    is_visible: true,
  },
  {
    id: 'inquiries',
    label: '問合せ',
    href: '/inquiries',
    match_prefix: true,
    sort_order: 30,
    is_visible: true,
  },
  {
    id: 'applications',
    label: '申込',
    href: '/applications',
    match_prefix: true,
    sort_order: 40,
    is_visible: true,
  },
  {
    id: 'activities',
    label: '対応歴',
    href: '/activities',
    match_prefix: true,
    sort_order: 45,
    is_visible: true,
  },
  {
    id: 'article_reactions',
    label: '記事反応リスト',
    href: '/article-reactions',
    match_prefix: true,
    sort_order: 47,
    is_visible: true,
  },
  {
    id: 'withdrawals',
    label: '出金管理',
    href: '/withdrawal-parents',
    match_prefix: false,
    sort_order: 48,
    is_visible: true,
    visible_roles: ['admin', 'manager', 'support'],
  },
  {
    id: 'withdrawal_parents',
    label: '出金管理-親',
    href: '/withdrawal-parents',
    match_prefix: true,
    sort_order: 10,
    is_visible: true,
    parent_id: 'withdrawals',
    visible_roles: ['admin', 'manager', 'support'],
  },
  {
    id: 'withdrawal_children',
    label: '出金管理-子',
    href: '/withdrawal-children',
    match_prefix: true,
    sort_order: 20,
    is_visible: true,
    parent_id: 'withdrawals',
    visible_roles: ['admin', 'manager', 'support'],
  },
  {
    id: 'summary',
    label: 'サマリ',
    href: '/summary',
    match_prefix: true,
    sort_order: 50,
    is_visible: true,
  },
  {
    id: 'reports',
    label: 'レポート',
    href: '/reports',
    match_prefix: true,
    sort_order: 60,
    is_visible: true,
  },
  { id: 'ai', label: 'AI', href: '/ai', match_prefix: false, sort_order: 70, is_visible: true },
];

const SELECT_COLS = 'id,label,href,match_prefix,sort_order,is_visible';
// migration 65 で追加(未適用環境ではこの列指定が失敗するため2段構えで取得する)
const SELECT_COLS_V2 = `${SELECT_COLS},parent_id,visible_roles`;

function toTab(n: NavItem): TabItem {
  return { href: n.href, label: n.label, matchPrefix: n.match_prefix };
}

async function fetchNavItems(): Promise<NavItem[] | null> {
  try {
    const supabase = await createClient();
    // 新列(parent_id/visible_roles)込みで取得 → migration 65 未適用なら旧列のみでリトライ
    let { data, error } = await supabase
      .from('nav_items')
      .select(SELECT_COLS_V2)
      .order('sort_order', { ascending: true });
    if (error) {
      ({ data, error } = await supabase
        .from('nav_items')
        .select(SELECT_COLS)
        .order('sort_order', { ascending: true }));
    }
    if (error || !data || data.length === 0) return null;
    return data as unknown as NavItem[];
  } catch {
    return null;
  }
}

/** DBに存在しないDEFAULT項目をマージする(migration未適用でも新タブが表示される) */
function mergeWithDefaults(dbRows: NavItem[]): NavItem[] {
  const dbIds = new Set(dbRows.map((r) => r.id));
  const missing = DEFAULT_NAV_ITEMS.filter((n) => !dbIds.has(n.id));
  return [...dbRows, ...missing].sort((a, b) => a.sort_order - b.sort_order);
}

/** ロールで表示可否を判定(visible_roles が null/未設定なら全ロール表示) */
function isAllowedForRole(n: NavItem, role: string | null): boolean {
  if (!n.visible_roles || n.visible_roles.length === 0) return true;
  return role != null && n.visible_roles.includes(role);
}

/**
 * レイアウト用: 表示ON項目を順序通りに、親子ツリー(TabItem.children)で返す。
 * role を渡すと visible_roles によるロール別表示を適用する。
 * 未適用・空・エラー時は既定にフォールバック。
 */
export async function getVisibleNavTabs(role?: string | null): Promise<TabItem[]> {
  const dbRows = await fetchNavItems();
  const rows = dbRows ? mergeWithDefaults(dbRows) : DEFAULT_NAV_ITEMS;
  const visible = rows.filter((n) => n.is_visible && isAllowedForRole(n, role ?? null));

  // 親子ツリー化: parent_id を持つ項目は親タブの children に入れる
  const childrenByParent = new Map<string, NavItem[]>();
  for (const n of visible) {
    if (!n.parent_id) continue;
    const arr = childrenByParent.get(n.parent_id) ?? [];
    arr.push(n);
    childrenByParent.set(n.parent_id, arr);
  }
  return visible
    .filter((n) => !n.parent_id)
    .map((n) => {
      const kids = (childrenByParent.get(n.id) ?? []).sort((a, b) => a.sort_order - b.sort_order);
      const tab = toTab(n);
      if (kids.length > 0) tab.children = kids.map(toTab);
      return tab;
    });
}

/** 設定編集用: 全項目(非表示含む)を順序通りに。フォールバックあり。 */
export async function getAllNavItems(): Promise<NavItem[]> {
  const dbRows = await fetchNavItems();
  return dbRows ? mergeWithDefaults(dbRows) : DEFAULT_NAV_ITEMS;
}
