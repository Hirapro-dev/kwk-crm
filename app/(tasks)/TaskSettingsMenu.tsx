'use client';

import { LogoutButton } from '@/components/layout/LogoutButton';
import { Bell, ExternalLink, Settings as SettingsIcon, UserCircle2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AvatarDialog } from './AvatarDialog';
import { NotificationSettingsDialog } from './NotificationSettingsDialog';

/** タスク管理のヘッダーの歯車メニュー(CRM の設定へ(admin)/ ログアウト)。メーラーの MailerSettingsMenu と同じ操作感 */
export function TaskSettingsMenu({
  isAdmin,
  profile,
}: {
  isAdmin: boolean;
  /** プロフィール画像の設定(migration 114) */
  profile?: { name: string | null; email: string; avatarPath: string | null };
}) {
  const [open, setOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
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
        aria-label="設定メニュー"
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
          className="absolute right-0 z-50 mt-2 w-56 rounded border bg-popover py-1 text-foreground shadow-lg"
        >
          {profile && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setAvatarOpen(true);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
            >
              <UserCircle2 className="h-3.5 w-3.5" />
              プロフィール画像
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setNotifyOpen(true);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
          >
            <Bell className="h-3.5 w-3.5" />
            通知の設定
          </button>
          {isAdmin && (
            <>
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
                <ExternalLink className="h-3 w-3 opacity-60" />
              </a>
              <div className="my-1 border-t" />
            </>
          )}
          <LogoutButton variant="menu" />
        </div>
      )}
      <NotificationSettingsDialog open={notifyOpen} onOpenChange={setNotifyOpen} />
      {profile && (
        <AvatarDialog
          open={avatarOpen}
          onOpenChange={setAvatarOpen}
          name={profile.name}
          email={profile.email}
          avatarPath={profile.avatarPath}
        />
      )}
    </div>
  );
}
