'use client';

import {
  ExternalLink,
  LogOut,
  Settings as SettingsIcon,
  User,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { devLogout } from '@/lib/domain/dev_auth_actions';
import { createClient } from '@/lib/supabase/client';

/**
 * Topbar の歯車アイコンクリックで開くプルダウンメニュー。
 *
 * 構成:
 *   - 設定 (admin のみ表示) → /admin/users
 *   - プロフィール → /account
 *   - ──────────
 *   - 外部ツール7個 (新規タブで開く)
 *   - ──────────
 *   - ログアウト
 *
 * 外側クリック / Escape で閉じる。
 */
interface Props {
  /** 現在ユーザーが admin か (設定メニュー表示制御) */
  isAdmin: boolean;
}

interface ExternalLinkItem {
  label: string;
  url: string;
}

const EXTERNAL_LINKS: ExternalLinkItem[] = [
  {
    label: 'Notion',
    url: 'https://www.notion.so/URL-1ac67ba4c2398040b767e79592e13d44',
  },
  {
    label: '作業報告システム',
    url: 'https://hirapro.jp/sales/kaiseki',
  },
  {
    label: 'BioVaultメンバーシップ',
    url: 'https://member.biovault.jp/',
  },
  {
    label: 'BioVault LIVE配信システム',
    url: 'https://bvlive.sc-project-partners.co.jp/admin',
  },
  {
    label: 'メールディーラー',
    url: 'https://mds3191.maildealer.jp/app/',
  },
  {
    label: 'ASANA',
    url: 'https://app.asana.com/1/1168208518146180/project/1174652472059214/list/1208025589043274',
  },
  {
    label: 'ChatGPT',
    url: 'https://chatgpt.com/',
  },
];

export function SettingsMenu({ isAdmin }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  // 外側クリック / Escape で閉じる
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const onLogout = () => {
    startTransition(async () => {
      await devLogout();
      const supabase = createClient();
      await supabase.auth.signOut();
      setOpen(false);
      router.push('/login');
      router.refresh();
    });
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="設定"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid h-8 w-8 place-items-center rounded text-white/90 hover:bg-white/10 hover:text-white"
      >
        <SettingsIcon className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 rounded border bg-popover py-1 text-foreground shadow-lg"
        >
          {/* 内部メニュー */}
          {isAdmin && (
            <MenuLink
              href="/settings"
              icon={<SettingsIcon className="h-3.5 w-3.5" />}
              label="設定"
              onSelect={() => setOpen(false)}
            />
          )}
          <MenuLink
            href="/account"
            icon={<User className="h-3.5 w-3.5" />}
            label="プロフィール"
            onSelect={() => setOpen(false)}
          />

          <MenuDivider />

          {/* 外部ツール */}
          <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            外部ツール
          </p>
          {EXTERNAL_LINKS.map((link) => (
            <MenuExternal key={link.url} {...link} onSelect={() => setOpen(false)} />
          ))}

          <MenuDivider />

          {/* ログアウト */}
          <button
            type="button"
            role="menuitem"
            onClick={onLogout}
            disabled={pending}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>{pending ? 'ログアウト中...' : 'ログアウト'}</span>
          </button>
        </div>
      )}
    </div>
  );
}

function MenuLink({
  href,
  icon,
  label,
  onSelect,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  onSelect: () => void;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onSelect}
      className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}

function MenuExternal({
  url,
  label,
  onSelect,
}: ExternalLinkItem & { onSelect: () => void }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      role="menuitem"
      onClick={onSelect}
      className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-accent"
    >
      <span>{label}</span>
      <ExternalLink className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
    </a>
  );
}

function MenuDivider() {
  return <div className="my-1 border-t border-border" />;
}
