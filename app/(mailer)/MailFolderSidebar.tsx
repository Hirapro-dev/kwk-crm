'use client';

import type { MailFolderGroup } from '@/lib/domain/mail_folders';
import { cn } from '@/lib/utils/cn';
import { ChevronDown, ChevronRight, Inbox, PanelLeft, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { createContext, useContext, useState } from 'react';

/**
 * メーラー左ペイン: 受信箱フォルダ(仕様書 §5.15 / §8.1)。
 *
 * メールディーラーと同じく「ドメイン(会社/ブランド) > アドレス」の階層で受信箱を並べ、
 * 各フォルダに未対応件数を出す。クリックで右の一覧をその受信箱に絞る
 * (`?box=ID`。状態タブは維持し、検索語は解除)。
 * PC では常時表示、モバイルではヘッダーのボタンでドロワー表示。
 */

interface Props {
  groups: MailFolderGroup[];
  total: { pendingCount: number; unreadCount: number };
}

/** モバイル用の開閉状態をヘッダーのボタンと共有する */
const SidebarOpenContext = createContext<{
  open: boolean;
  setOpen: (v: boolean) => void;
} | null>(null);

export function MailFolderSidebarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <SidebarOpenContext.Provider value={{ open, setOpen }}>{children}</SidebarOpenContext.Provider>
  );
}

export function MailFolderToggleButton() {
  const ctx = useContext(SidebarOpenContext);
  if (!ctx) return null;
  return (
    <button
      type="button"
      aria-label="フォルダを開く"
      onClick={() => ctx.setOpen(true)}
      className="grid h-8 w-8 place-items-center rounded hover:bg-white/10 md:hidden"
    >
      <PanelLeft className="h-4 w-4" />
    </button>
  );
}

function CountBadge({ n, strong }: { n: number; strong?: boolean }) {
  if (n <= 0) return null;
  return (
    <span
      className={cn(
        'ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none',
        strong ? 'bg-orange-500 text-white' : 'bg-muted text-muted-foreground',
      )}
    >
      {n > 999 ? '999+' : n}
    </span>
  );
}

function FolderTree({ groups, total, onNavigate }: Props & { onNavigate?: () => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentBox = searchParams.get('box') ?? '';
  const onList = pathname === '/mail';
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // フォルダを切り替えるとき、状態タブは維持し、検索語・担当などは解除する
  const hrefFor = (boxId: number | null) => {
    const p = new URLSearchParams();
    const tab = searchParams.get('tab');
    if (tab) p.set('tab', tab);
    if (boxId !== null) p.set('box', String(boxId));
    const qs = p.toString();
    return qs ? `/mail?${qs}` : '/mail';
  };

  const itemClass = (active: boolean) =>
    cn(
      'flex items-center gap-2 rounded px-2 py-1.5 text-sm',
      active ? 'bg-primary/10 font-semibold text-primary' : 'hover:bg-accent',
    );

  return (
    <nav className="space-y-1 p-2 text-sm">
      <Link
        href={hrefFor(null)}
        onClick={onNavigate}
        className={itemClass(onList && currentBox === '')}
      >
        <Inbox className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
        <span className="truncate">すべての受信箱</span>
        <CountBadge n={total.pendingCount} strong />
      </Link>

      {groups.length === 0 && (
        <p className="px-2 py-2 text-xs text-muted-foreground">受信箱が登録されていません。</p>
      )}

      {groups.map((g) => {
        const isCollapsed = collapsed[g.domain] ?? false;
        return (
          <div key={g.domain}>
            <button
              type="button"
              onClick={() => setCollapsed((c) => ({ ...c, [g.domain]: !isCollapsed }))}
              className="flex w-full items-center gap-1 rounded px-1 py-1.5 text-left text-xs font-semibold text-muted-foreground hover:bg-accent"
              aria-expanded={!isCollapsed}
            >
              {isCollapsed ? (
                <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              )}
              <span className="truncate">{g.domain || '(ドメインなし)'}</span>
              {isCollapsed && <CountBadge n={g.pendingCount} strong />}
            </button>
            {!isCollapsed && (
              <div className="ml-3 space-y-0.5 border-l pl-2">
                {g.items.map((b) => {
                  const active = onList && currentBox === String(b.id);
                  return (
                    <Link
                      key={b.id}
                      href={hrefFor(b.id)}
                      onClick={onNavigate}
                      className={cn(itemClass(active), !b.isActive && 'opacity-60')}
                      title={b.displayName ? `${b.displayName} <${b.address}>` : b.address}
                    >
                      <span className="truncate">{b.localPart}</span>
                      {!b.isActive && (
                        <span className="text-[10px] text-muted-foreground">(停止)</span>
                      )}
                      <CountBadge n={b.pendingCount} strong />
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export function MailFolderSidebar(props: Props) {
  const ctx = useContext(SidebarOpenContext);
  const open = ctx?.open ?? false;
  const close = () => ctx?.setOpen(false);

  return (
    <>
      {/* PC: 常時表示 */}
      <aside className="hidden w-60 shrink-0 overflow-y-auto border-r bg-card md:block">
        <FolderTree {...props} />
      </aside>

      {/* モバイル: ドロワー */}
      {open && (
        <div className="fixed inset-0 z-[200] flex md:hidden" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={close}
            onKeyDown={(e) => e.key === 'Escape' && close()}
            role="presentation"
          />
          <div className="relative z-10 flex h-full w-72 max-w-[85vw] flex-col bg-card shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-bold">受信箱</span>
              <button
                type="button"
                onClick={close}
                className="grid h-8 w-8 place-items-center rounded text-muted-foreground hover:bg-accent"
                aria-label="閉じる"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <FolderTree {...props} onNavigate={close} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
