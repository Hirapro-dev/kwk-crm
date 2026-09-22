import type { AppUser } from '@/lib/domain/types';
import { ExternalLink, ListChecks, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { TaskSettingsMenu } from './TaskSettingsMenu';

/**
 * タスク管理(/task)専用の黒ヘッダー(仕様書 §8.1)。メーラーの MailerTopbar と同じ構成。
 * 右の歯車からログアウト(全ロール)と CRM の設定(admin)。左端のメニューボタンで左メニューを開閉(TaskShell)。
 */
export function TaskTopbar({
  me,
  onMenuClick,
  menuOpen,
}: {
  me: AppUser;
  /** 左メニューの開閉(PC は畳む/出す、スマホは重ねて開く/閉じる) */
  onMenuClick?: () => void;
  /** スマホで重ねメニューが開いているか(アイコンの切替用) */
  menuOpen?: boolean;
}) {
  const userInitial = (me.full_name ?? me.email).charAt(0).toUpperCase();
  return (
    <header className="sf-header relative">
      <div className="flex h-12 items-center gap-3 px-3 sm:px-4">
        {onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            aria-label={menuOpen ? 'メニューを閉じる' : 'メニューを開く'}
            title="左メニューの表示/非表示"
            className="grid h-8 w-8 place-items-center rounded text-white/90 hover:bg-white/10"
          >
            {menuOpen ? (
              <X className="h-5 w-5 md:hidden" aria-hidden="true" />
            ) : (
              <Menu className="h-5 w-5 md:hidden" aria-hidden="true" />
            )}
            <Menu className="hidden h-5 w-5 md:block" aria-hidden="true" />
          </button>
        )}
        <div className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 opacity-90" aria-hidden="true" />
          <Link href="/task" className="text-sm font-semibold tracking-tight">
            ひらプロタスク
          </Link>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden items-center gap-1 rounded px-2 py-1 text-xs text-white/80 hover:bg-white/10 hover:text-white sm:inline-flex"
          >
            CRM を開く
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
          <div
            className="grid h-7 w-7 place-items-center rounded-full bg-white/20 text-xs font-semibold"
            aria-hidden="true"
          >
            {userInitial}
          </div>
          <span className="hidden text-xs opacity-90 sm:inline">{me.full_name ?? me.email}</span>
          <TaskSettingsMenu isAdmin={me.role === 'admin'} />
        </div>
      </div>
    </header>
  );
}
