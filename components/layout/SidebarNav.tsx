'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * Phase 4 用の強化版サイドナビ。
 * - Client Component(usePathname でアクティブ判定)
 * - ロールに応じた表示制御は親(Server Component)から `items` を絞って渡す
 * - Phase 0 の Sidebar.tsx は最小実装として温存し、ここを実利用版とする
 */

export interface SidebarItem {
  href: string;
  label: string;
  icon?: ReactNode;
  /** 例: '/members' の下層 '/members/[id]' でもアクティブ表示にする */
  matchPrefix?: boolean;
}

export interface SidebarSection {
  label?: string;
  items: SidebarItem[];
}

export function SidebarNav({ sections }: { sections: SidebarSection[] }) {
  const pathname = usePathname();

  const isActive = (item: SidebarItem): boolean => {
    if (!pathname) return false;
    if (item.matchPrefix) {
      return pathname === item.href || pathname.startsWith(`${item.href}/`);
    }
    return pathname === item.href;
  };

  return (
    <nav className="flex-1 overflow-y-auto p-2">
      {sections.map((sec, i) => (
        <div key={i} className="mb-4">
          {sec.label && (
            <p className="px-3 pb-1 text-xs font-medium uppercase text-muted-foreground">
              {sec.label}
            </p>
          )}
          <ul className="space-y-0.5">
            {sec.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                    isActive(item)
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
