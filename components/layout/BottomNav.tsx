'use client';

import {
  Activity,
  BarChart3,
  ClipboardList,
  FileBarChart,
  Home,
  MessageSquare,
  Settings,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';
import type { TabItem } from './TabsNav';

/** href → lucide アイコン のマッピング */
const ICON_MAP: Record<string, ReactNode> = {
  '/':            <Home      className="h-5 w-5" />,
  '/members':     <Users     className="h-5 w-5" />,
  '/inquiries':   <MessageSquare className="h-5 w-5" />,
  '/applications':<ClipboardList className="h-5 w-5" />,
  '/activities':  <Activity  className="h-5 w-5" />,
  '/summary':     <BarChart3 className="h-5 w-5" />,
  '/reports':     <FileBarChart  className="h-5 w-5" />,
  '/settings':    <Settings  className="h-5 w-5" />,
};

/** デフォルトアイコン(マッピング外用) */
function DefaultIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5 fill-current" aria-hidden="true">
      <circle cx="10" cy="10" r="3" />
    </svg>
  );
}

interface Props {
  tabs: TabItem[];
}

/**
 * モバイル専用・画面下部固定のボトムナビゲーション。
 * md 以上では非表示 (md:hidden)。
 * タブが多い場合は横スクロール対応。
 */
export function BottomNav({ tabs }: Props) {
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
      <div className="flex h-16 items-stretch overflow-x-auto">
        {tabs.map((tab) => {
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
