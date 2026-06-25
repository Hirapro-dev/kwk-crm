'use client';

import {
  Activity,
  BarChart3,
  ClipboardList,
  FileBarChart,
  Home,
  MessageSquare,
  Settings,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';
import type { TabItem } from './TabsNav';

const ICON_MAP: Record<string, ReactNode> = {
  '/':             <Home         className="h-6 w-6" />,
  '/members':      <Users        className="h-6 w-6" />,
  '/inquiries':    <MessageSquare className="h-6 w-6" />,
  '/applications': <ClipboardList className="h-6 w-6" />,
  '/activities':   <Activity     className="h-6 w-6" />,
  '/summary':      <BarChart3    className="h-6 w-6" />,
  '/reports':      <FileBarChart  className="h-6 w-6" />,
  '/settings':     <Settings     className="h-6 w-6" />,
  '/ai':           <Sparkles     className="h-6 w-6" />,
};

const ALL_EXTRA_ITEMS: TabItem[] = [
  { href: '/settings', label: '設定', matchPrefix: true },
  { href: '/ai',       label: 'AI',  matchPrefix: false },
];

interface Props {
  tabs: TabItem[];
}

/**
 * 左上の九つ四角アイコン。クリックで全メニューオーバーレイを開く。
 * Topbar (Server Component) から props として受け取る。
 */
export function AppLauncherButton({ tabs }: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const allItems = [
    ...tabs,
    ...ALL_EXTRA_ITEMS.filter((e) => !tabs.some((t) => t.href === e.href)),
  ];

  const isActive = (tab: TabItem) => {
    if (!pathname) return false;
    if (tab.href === '/') return pathname === '/';
    if (tab.matchPrefix) return pathname === tab.href || pathname.startsWith(`${tab.href}/`);
    return pathname === tab.href;
  };

  return (
    <>
      {/* 九つ四角ボタン */}
      <button
        type="button"
        aria-label="全メニューを開く"
        onClick={() => setOpen(true)}
        className="grid h-8 w-8 place-items-center rounded hover:bg-white/10"
      >
        <AppLauncherIcon />
      </button>

      {/* オーバーレイ */}
      {open && (
        <div className="fixed inset-0 z-[200] flex flex-col" aria-modal="true">
          {/* 背景 */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          {/* ドロワー */}
          <div className="relative z-10 flex h-full w-72 max-w-[85vw] flex-col bg-card shadow-xl">
            {/* ヘッダー */}
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-bold tracking-tight">メニュー</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid h-8 w-8 place-items-center rounded text-muted-foreground hover:bg-accent"
                aria-label="閉じる"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* メニュー一覧 */}
            <nav className="flex-1 overflow-y-auto py-2">
              {allItems.map((tab) => {
                const active = isActive(tab);
                const icon = ICON_MAP[tab.href] ?? <DefaultIcon />;
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      'flex items-center gap-3 px-5 py-3 text-sm font-medium transition-colors',
                      active
                        ? 'bg-primary/10 text-primary'
                        : 'text-foreground hover:bg-accent',
                    )}
                  >
                    <span className={cn('opacity-70', active && 'opacity-100 text-primary')}>
                      {icon}
                    </span>
                    <span>{tab.label}</span>
                    {tab.href === '/ai' && (
                      <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                        Coming Soon
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      )}
    </>
  );
}

function AppLauncherIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 fill-current" aria-hidden="true">
      <circle cx="3"  cy="3"  r="1.3" />
      <circle cx="8"  cy="3"  r="1.3" />
      <circle cx="13" cy="3"  r="1.3" />
      <circle cx="3"  cy="8"  r="1.3" />
      <circle cx="8"  cy="8"  r="1.3" />
      <circle cx="13" cy="8"  r="1.3" />
      <circle cx="3"  cy="13" r="1.3" />
      <circle cx="8"  cy="13" r="1.3" />
      <circle cx="13" cy="13" r="1.3" />
    </svg>
  );
}

function DefaultIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-6 w-6 fill-current" aria-hidden="true">
      <circle cx="10" cy="10" r="3" />
    </svg>
  );
}
