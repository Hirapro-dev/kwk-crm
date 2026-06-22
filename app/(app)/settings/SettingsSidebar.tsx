'use client';

import {
  Boxes,
  Briefcase,
  CloudDownload,
  Folders,
  Home as HomeIcon,
  Menu as MenuIcon,
  Upload,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';

/**
 * Salesforce Setup 風 左サイドメニュー。
 *
 * セクション + 項目の階層で表示。今後管理者用メニューが増えてもここに追記する。
 * アクティブな項目はパス一致でハイライト。
 */
interface MenuItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

interface MenuSection {
  label: string;
  items: MenuItem[];
}

const SECTIONS: MenuSection[] = [
  {
    label: 'ホーム',
    items: [
      { href: '/settings', label: '設定ホーム', icon: <HomeIcon className="h-3.5 w-3.5" /> },
    ],
  },
  {
    label: '管理',
    items: [
      { href: '/settings/users', label: 'ユーザー管理', icon: <Users className="h-3.5 w-3.5" /> },
      {
        href: '/settings/projects',
        label: '案件マスタ',
        icon: <Briefcase className="h-3.5 w-3.5" />,
      },
      {
        href: '/settings/objects',
        label: 'オブジェクト管理',
        icon: <Boxes className="h-3.5 w-3.5" />,
      },
      {
        href: '/settings/import',
        label: 'データ取込',
        icon: <Upload className="h-3.5 w-3.5" />,
      },
      {
        href: '/settings/import-routine',
        label: '定期取込(Drive)',
        icon: <CloudDownload className="h-3.5 w-3.5" />,
      },
    ],
  },
  {
    label: 'システム',
    items: [
      {
        href: '/settings/navigation',
        label: 'メニューバー',
        icon: <MenuIcon className="h-3.5 w-3.5" />,
      },
      // 今後: ロール定義 / フォームマスタ / 活動分類マスタなどを追加予定
    ],
  },
];

export function SettingsSidebar() {
  const pathname = usePathname();

  const isActive = (href: string): boolean => {
    if (!pathname) return false;
    if (href === '/settings') return pathname === '/settings';
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <aside className="w-56 shrink-0 border-r bg-card">
      <div className="border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Folders className="h-4 w-4 text-primary" aria-hidden="true" />
          <h2 className="text-sm font-bold">設定</h2>
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">管理者のみ</p>
      </div>
      <nav className="p-2">
        {SECTIONS.map((sec) => (
          <div key={sec.label} className="mb-3">
            <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              {sec.label}
            </p>
            <ul className="space-y-0.5">
              {sec.items.length === 0 ? (
                <li className="px-3 py-1.5 text-xs text-muted-foreground">(なし)</li>
              ) : (
                sec.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        'flex items-center gap-2 rounded px-3 py-1.5 text-sm transition-colors',
                        isActive(item.href)
                          ? 'bg-primary/10 font-bold text-primary'
                          : 'text-foreground hover:bg-accent',
                      )}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </Link>
                  </li>
                ))
              )}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
