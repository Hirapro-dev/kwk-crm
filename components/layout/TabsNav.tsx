'use client';

import { ChevronDown, Pencil } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';

/**
 * Salesforce Lightning 風 横タブナビゲーション(NavigationBar)。
 *
 * 構成:
 *  - 左端: アプリアイコン色付きチップ + アプリ名
 *  - 横並びタブ(現在地はアクティブ表示: 下線 + 太字)
 *  - 右端: 編集ペン(レイアウト編集相当のダミー、CSS上の見た目だけ)
 *
 * モバイル: 横スクロール可能。
 */
export interface TabItem {
  href: string;
  label: string;
  /** /members の下層 /members/[id] でもアクティブ表示 */
  matchPrefix?: boolean;
}

interface Props {
  appName: string;
  /** アプリアイコンの色(チップ背景) */
  appColor?: string;
  tabs: TabItem[];
}

export function TabsNav({ appName, appColor = '#1589ee', tabs }: Props) {
  const pathname = usePathname();

  const isActive = (tab: TabItem): boolean => {
    if (!pathname) return false;
    // ルートはマッチプレフィクス効かせると全部マッチしてしまうので等価比較
    if (tab.href === '/') return pathname === '/';
    if (tab.matchPrefix) {
      return pathname === tab.href || pathname.startsWith(`${tab.href}/`);
    }
    return pathname === tab.href;
  };

  return (
    <div className="border-b bg-card">
      <div className="flex h-10 items-stretch">
        {/* アプリアイコン + アプリ名 */}
        <div className="flex items-center gap-2 border-r px-4">
          <span
            className="sf-icon-chip"
            style={{ backgroundColor: appColor }}
            aria-hidden="true"
          >
            CRM
          </span>
          <span className="text-sm font-semibold text-foreground">{appName}</span>
        </div>

        {/* タブ */}
        <nav className="flex flex-1 items-stretch overflow-x-auto">
          {tabs.map((tab) => {
            const active = isActive(tab);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  'group relative inline-flex items-center gap-1 whitespace-nowrap border-b-[3px] px-4 text-sm transition-colors',
                  active
                    ? 'border-primary font-bold text-foreground'
                    : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {tab.label}
                <ChevronDown
                  className="h-3 w-3 opacity-50 group-hover:opacity-100"
                  aria-hidden="true"
                />
              </Link>
            );
          })}
        </nav>

        {/* 右端: 編集ペン(SF レイアウト編集相当のUIダミー) */}
        <div className="flex items-center border-l px-3">
          <button
            type="button"
            aria-label="ナビゲーションを編集"
            className="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
