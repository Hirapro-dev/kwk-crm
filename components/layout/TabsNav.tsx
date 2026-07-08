'use client';

import { cn } from '@/lib/utils/cn';
import { ChevronDown, Pencil } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

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
  /** ホバープルダウンで表示する子項目(出金管理-親/子 等) */
  children?: TabItem[];
}

interface Props {
  appName: string;
  /** アプリアイコンの色(チップ背景) */
  appColor?: string;
  tabs: TabItem[];
}

export function TabsNav({ appName, appColor = '#00C896', tabs }: Props) {
  const pathname = usePathname();

  const isActive = (tab: TabItem): boolean => {
    if (!pathname) return false;
    // ルートはマッチプレフィクス効かせると全部マッチしてしまうので等価比較
    if (tab.href === '/') return pathname === '/';
    // 子を持つタブは、いずれかの子がアクティブなら親もアクティブ表示
    if (tab.children?.some((c) => isActive(c))) return true;
    if (tab.matchPrefix) {
      return pathname === tab.href || pathname.startsWith(`${tab.href}/`);
    }
    return pathname === tab.href;
  };

  return (
    <div className="border-b bg-card">
      <div className="flex h-10 items-stretch">
        {/* アプリアイコン(アプリ名はアイコンのみ表示にするため非表示) */}
        <div className="flex items-center border-r px-4" title={appName}>
          <span className="sf-icon-chip" style={{ backgroundColor: appColor }} aria-hidden="true">
            CRM
          </span>
        </div>

        {/* タブ。ホバープルダウンを下にはみ出して表示するため overflow は可視にする
            (overflow-x-auto だとスクロールコンテナ化してプルダウンが切り取られる)。
            TabsNav は md 以上専用(モバイルは BottomNav)のため横スクロールは廃止。 */}
        <nav className="flex flex-1 items-stretch overflow-visible">
          {tabs.map((tab) => {
            const active = isActive(tab);
            const tabClass = cn(
              'group relative inline-flex items-center gap-1 whitespace-nowrap border-b-[3px] px-4 text-sm transition-colors',
              active
                ? 'border-primary font-bold text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
            );

            // 子を持つタブ: ホバーでプルダウンを表示(クリックは先頭子=hrefへ遷移)
            if (tab.children && tab.children.length > 0) {
              return (
                <div key={tab.href + tab.label} className="group/menu relative flex items-stretch">
                  <Link href={tab.href} className={tabClass}>
                    {tab.label}
                    <ChevronDown
                      className="h-3 w-3 opacity-50 group-hover:opacity-100"
                      aria-hidden="true"
                    />
                  </Link>
                  {/* ホバープルダウン */}
                  <div className="invisible absolute left-0 top-full z-50 min-w-[11rem] rounded-b border border-t-0 bg-card py-1 opacity-0 shadow-md transition-opacity group-hover/menu:visible group-hover/menu:opacity-100">
                    {tab.children.map((child) => (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={cn(
                          'block px-4 py-2 text-sm',
                          isActive(child)
                            ? 'font-bold text-foreground'
                            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                        )}
                      >
                        {child.label}
                      </Link>
                    ))}
                  </div>
                </div>
              );
            }

            return (
              <Link key={tab.href} href={tab.href} className={tabClass}>
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
