'use client';

import { ExternalLink, Inbox, Settings as SettingsIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

/**
 * メーラーのヘッダーの歯車アイコンで開く、メール専用の設定メニュー(admin のみ表示)。
 * CRM 本体の SettingsMenu と同じ操作感(外側クリック / Escape で閉じる)。
 *
 *   - メール設定(受信箱・送信ドメイン) → /mail/settings
 *   - CRM の設定へ → /settings(別タブ。メーラーは独立画面のため)
 */
export function MailerSettingsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="メール設定"
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
          <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            メール設定
          </p>
          <Link
            href="/mail/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
          >
            <Inbox className="h-3.5 w-3.5" />
            <span>受信箱・送信ドメイン</span>
          </Link>
          <div className="my-1 border-t" />
          <a
            href="/settings"
            target="_blank"
            rel="noopener noreferrer"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-accent"
          >
            <span className="flex items-center gap-2">
              <SettingsIcon className="h-3.5 w-3.5" />
              CRM の設定
            </span>
            <ExternalLink className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
          </a>
        </div>
      )}
    </div>
  );
}
