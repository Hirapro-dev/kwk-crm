import { Bell, HelpCircle } from 'lucide-react';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/domain/auth';
import { AppLauncherButton } from './AppLauncherButton';
import { HeaderSearch } from './HeaderSearch';
import { MobileSearchToggle } from './MobileSearchToggle';
import { SettingsMenu } from './SettingsMenu';
import type { TabItem } from './TabsNav';

/**
 * Salesforce Lightning 風 濃紺ヘッダーバー。
 *
 * 構成:
 *  - 左: アプリランチャー(9ドット・全メニュー) + アプリ名
 *  - 中央: 全体検索ボックス
 *  - 右: ヘルプ / 設定(プルダウン) / 通知 / ユーザーアバター
 */
export async function Topbar({ tabs }: { tabs: TabItem[] }) {
  const me = await getCurrentUser();
  const userInitial = (me.full_name ?? me.email).charAt(0).toUpperCase();
  const isAdmin = me.role === 'admin';

  return (
    <header className="sf-header relative flex h-12 items-center gap-3 px-4">
      {/* 左: アプリランチャー(クライアント) + アプリ名 */}
      <div className="flex items-center gap-3">
        <AppLauncherButton tabs={tabs} />
        <Link href="/" className="text-sm font-semibold tracking-tight">
          ひらプロCRM
        </Link>
      </div>

      {/* 中央: 検索 (PC のみ表示) */}
      <div className="ml-4 hidden w-80 md:block">
        <HeaderSearch />
      </div>

      {/* 右: アイコン群 */}
      <div className="ml-auto flex items-center gap-1">
        {/* PC のみ: ヘルプ・設定・通知 */}
        <div className="hidden md:flex md:items-center md:gap-1">
          <HeaderIconButton aria-label="ヘルプ">
            <HelpCircle className="h-4 w-4" />
          </HeaderIconButton>
          <SettingsMenu isAdmin={isAdmin} />
          <HeaderIconButton aria-label="通知">
            <Bell className="h-4 w-4" />
          </HeaderIconButton>
        </div>
        {/* モバイル: 検索トグル + 設定 */}
        <div className="flex items-center md:hidden">
          <MobileSearchToggle />
          <SettingsMenu isAdmin={isAdmin} />
        </div>
        {/* ユーザーアバター (常時表示) */}
        <div className="ml-1 flex items-center gap-2">
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

