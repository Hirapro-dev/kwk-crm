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
}

/** migration 14 のシードと一致させる既定値(フォールバック用) */
export const DEFAULT_NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'ダッシュボード', href: '/', match_prefix: false, sort_order: 10, is_visible: true },
  { id: 'members', label: '顧客情報', href: '/members', match_prefix: true, sort_order: 20, is_visible: true },
  { id: 'inquiries', label: '問合せ', href: '/inquiries', match_prefix: true, sort_order: 30, is_visible: true },
  { id: 'applications', label: '申込', href: '/applications', match_prefix: true, sort_order: 40, is_visible: true },
  { id: 'summary', label: 'サマリ', href: '/summary', match_prefix: true, sort_order: 50, is_visible: true },
  { id: 'reports', label: 'レポート', href: '/reports', match_prefix: true, sort_order: 60, is_visible: true },
  { id: 'ai', label: 'AI', href: '/ai', match_prefix: false, sort_order: 70, is_visible: true },
];

const SELECT_COLS = 'id,label,href,match_prefix,sort_order,is_visible';

function toTab(n: NavItem): TabItem {
  return { href: n.href, label: n.label, matchPrefix: n.match_prefix };
}

async function fetchNavItems(): Promise<NavItem[] | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('nav_items')
      .select(SELECT_COLS)
      .order('sort_order', { ascending: true });
    if (error || !data || data.length === 0) return null;
    return data as unknown as NavItem[];
  } catch {
    return null;
  }
}

/** レイアウト用: 表示ON項目を順序通りに。未適用・空・エラー時は既定にフォールバック。 */
export async function getVisibleNavTabs(): Promise<TabItem[]> {
  const rows = (await fetchNavItems()) ?? DEFAULT_NAV_ITEMS;
  return rows.filter((n) => n.is_visible).map(toTab);
}

/** 設定編集用: 全項目(非表示含む)を順序通りに。フォールバックあり。 */
export async function getAllNavItems(): Promise<NavItem[]> {
  return (await fetchNavItems()) ?? DEFAULT_NAV_ITEMS;
}
