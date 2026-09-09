import { LogoutButton } from '@/components/layout/LogoutButton';
import type { AppUser } from '@/lib/domain/types';
import { ExternalLink, Mail, PenSquare } from 'lucide-react';
import Link from 'next/link';
import { MailFolderToggleButton } from './MailFolderSidebar';
import { MailerSettingsMenu } from './MailerSettingsMenu';

/**
 * メーラー(/mail)専用の黒ヘッダー(仕様書 §8.1)。
 * CRM 本体の Topbar/TabsNav は出さず、メーラーとして独立した画面にする
 * (アプリランチャーから別タブで開く運用)。右側の歯車はメール専用の設定メニュー(admin のみ)。
 */
export function MailerTopbar({ me }: { me: AppUser }) {
  const userInitial = (me.full_name ?? me.email).charAt(0).toUpperCase();
  return (
    <header className="sf-header relative">
      <div className="flex h-12 items-center gap-3 px-4">
        <div className="flex items-center gap-2">
          <MailFolderToggleButton />
          <Mail className="h-4 w-4 opacity-90" aria-hidden="true" />
          <Link href="/mail" className="text-sm font-semibold tracking-tight">
            ひらプロメーラー
          </Link>
        </div>

        <Link
          href="/mail/new"
          className="ml-3 inline-flex h-8 items-center gap-1 rounded bg-white/15 px-3 text-xs font-medium hover:bg-white/25"
        >
          <PenSquare className="h-3.5 w-3.5" aria-hidden="true" />
          メール作成
        </Link>

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
          {me.role === 'admin' && <MailerSettingsMenu />}
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
