'use client';

import { cn } from '@/lib/utils/cn';
import { CheckCircle2, Home, ListTodo, Menu, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * スマホ(md 未満)の下タブ(Asana のモバイルアプリ風。§8.1。2026-09-22)。
 * ホーム / マイタスク / プロジェクト / 検索 / メニュー(左メニューを重ねて開く: マイフォルダ・参加プロジェクト)。
 */
export function TaskMobileTabBar({
  onMenuClick,
  menuOpen,
}: {
  onMenuClick: () => void;
  menuOpen: boolean;
}) {
  const pathname = usePathname();
  const tabs = [
    { href: '/task', label: 'ホーム', icon: Home, exact: true },
    { href: '/task/my', label: 'マイタスク', icon: CheckCircle2, exact: false },
    { href: '/task/projects', label: 'プロジェクト', icon: ListTodo, exact: false },
    { href: '/task/search', label: '検索', icon: Search, exact: false },
  ];
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      aria-label="タスク管理のメニュー"
    >
      {tabs.map((t) => {
        const active = !menuOpen && (t.exact ? pathname === t.href : pathname.startsWith(t.href));
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              'flex flex-col items-center gap-0.5 py-2 text-[10px]',
              active ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 1.8} aria-hidden="true" />
            {t.label}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onMenuClick}
        className={cn(
          'flex flex-col items-center gap-0.5 py-2 text-[10px]',
          menuOpen ? 'text-foreground' : 'text-muted-foreground',
        )}
        aria-label="メニュー"
      >
        <Menu className="h-5 w-5" strokeWidth={menuOpen ? 2.4 : 1.8} aria-hidden="true" />
        メニュー
      </button>
    </nav>
  );
}
