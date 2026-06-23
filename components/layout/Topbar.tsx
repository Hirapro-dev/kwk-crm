import { Bell, HelpCircle } from 'lucide-react';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/domain/auth';
import { HeaderSearch } from './HeaderSearch';
import { SettingsMenu } from './SettingsMenu';

/**
 * Salesforce Lightning 風 濃紺ヘッダーバー。
 *
 * 構成:
 *  - 左: アプリランチャー(9ドット) + アプリ名
 *  - 中央: 全体検索ボックス
 *  - 右: ヘルプ / 設定(プルダウン) / 通知 / ユーザーアバター
 *
 * 設定アイコンは SettingsMenu (Client) を使ってプルダウン化。
 * ログアウトは SettingsMenu 内のメニュー項目に統合した。
 */
export async function Topbar() {
  const me = await getCurrentUser();
  const userInitial = (me.full_name ?? me.email).charAt(0).toUpperCase();
  const isAdmin = me.role === 'admin';

  return (
    <header className="sf-header flex h-12 items-center gap-3 px-4">
      {/* 左: アプリランチャー + アプリ名 */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="アプリランチャー"
          className="grid h-8 w-8 place-items-center rounded hover:bg-white/10"
        >
          <AppLauncherIcon />
        </button>
        <Link href="/" className="text-sm font-semibold tracking-tight">
          ひらプロCRM
        </Link>
      </div>

      {/* 中央: 検索 (固定幅、ml-4 で左にだけ余白) */}
      <div className="ml-4 hidden w-80 md:block">
        <HeaderSearch />
      </div>

      {/* 右: アイコン群 (ml-auto で右端固定) */}
      <div className="ml-auto flex items-center gap-1">
        <HeaderIconButton aria-label="ヘルプ">
          <HelpCircle className="h-4 w-4" />
        </HeaderIconButton>
        {/* 設定: プルダウン (Client Component) */}
        <SettingsMenu isAdmin={isAdmin} />
        <HeaderIconButton aria-label="通知">
          <Bell className="h-4 w-4" />
        </HeaderIconButton>
        {/* ユーザーアバター */}
        <div className="ml-2 flex items-center gap-2">
          <div
            className="grid h-7 w-7 place-items-center rounded-full bg-white/20 text-xs font-semibold"
            aria-hidden="true"
          >
            {userInitial}
          </div>
          <div className="hidden flex-col text-xs leading-tight sm:flex">
            <span className="opacity-90">{me.full_name ?? me.email}</span>
          </div>
        </div>
      </div>
    </header>
  );
}

function HeaderIconButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className="grid h-8 w-8 place-items-center rounded text-white/90 hover:bg-white/10 hover:text-white"
    >
      {children}
    </button>
  );
}

/** 9ドット = アプリランチャーアイコン (SF Waffle Menu) */
function AppLauncherIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 fill-current" aria-hidden="true">
      <circle cx="3" cy="3" r="1.3" />
      <circle cx="8" cy="3" r="1.3" />
      <circle cx="13" cy="3" r="1.3" />
      <circle cx="3" cy="8" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="13" cy="8" r="1.3" />
      <circle cx="3" cy="13" r="1.3" />
      <circle cx="8" cy="13" r="1.3" />
      <circle cx="13" cy="13" r="1.3" />
    </svg>
  );
}
