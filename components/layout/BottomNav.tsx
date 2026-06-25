'use client';

import {
  BarChart3,
  FileBarChart,
  Home,
  Sparkles,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';
import type { TabItem } from './TabsNav';

/** ボトムナビに表示する項目(固定) */
const BOTTOM_ITEMS: TabItem[] = [
  { href: '/',        label: 'ダッシュボード', matchPrefix: false },
  { href: '/reports', label: 'レポート',       matchPrefix: true },
  { href: '/members', label: '顧客情報',       matchPrefix: true },
  { href: '/ai',      label: 'AI',             matchPrefix: false },
  { href: '/summary', label: 'サマリ',         matchPrefix: true },
];

/** href → lucide アイコン のマッピング */
const ICON_MAP: Record<string, ReactNode> = {
  '/':        <Home         className="h-5 w-5" />,
  '/members': <Users        className="h-5 w-5" />,
  '/summary': <BarChart3    className="h-5 w-5" />,
  '/reports': <FileBarChart  className="h-5 w-5" />,
  '/ai':      <Sparkles     className="h-5 w-5" />,
};

/** デフォルトアイコン(マッピング外用) */
function DefaultIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5 fill-current" aria-hidden="true">
      <circle cx="10" cy="10" r="3" />
    </svg>
  );
}

/**
 * モバイル専用・画面下部固定のボトムナビゲーション。
 * md 以上では非表示 (md:hidden)。
 * 表示項目は BOTTOM_ITEMS で固定 (申込・問合せは全メニューから開く)。
 */
export function BottomNav() {
  const pathname = usePathname();

  const isActive = (tab: TabItem): boolean => {
    if (!pathname) return false;
    if (tab.href === '/') return pathname === '/';
    if (tab.matchPrefix) {
      return pathname === tab.href || pathname.startsWith(`${tab.href}/`);
    }
    return pathname === tab.href;
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t bg-card shadow-[0_-1px_4px_rgba(0,0,0,0.08)] md:hidden"
      aria-label="メインナビゲーション"
    >
      <div className="flex h-16 items-stretch">
        {BOTTOM_ITEMS.map((tab) => {
          const active = isActive(tab);
          const icon = ICON_MAP[tab.href] ?? <DefaultIcon />;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'flex min-w-[64px] flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-medium transition-colors',
                active
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span className={cn('transition-transform', active && 'scale-110')}>
                {icon}
              </span>
              <span className="whitespace-nowrap leading-tight">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
