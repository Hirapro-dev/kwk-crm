'use client';

import { Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { createContext, useContext, useRef, useState } from 'react';

/**
 * モバイル検索シェル。
 *
 * 検索バーを「ヘッダーの内容行(h-12)の直下の通常フロー行」として描画する。
 * 絶対配置や env(safe-area-inset-top) の手計算を使わないため、
 * どの端末でも必ずヘッダー直下に正しく表示され、セーフエリア差でズレない。
 *
 * 使い方: <header><MobileSearchShell>{内容行}</MobileSearchShell></header>
 *   - 内容行の中に <MobileSearchToggleButton /> を置くとトグルできる
 *   - open のとき、内容行の直後にフルワイドの検索バー行が挿入される
 */
interface Ctx {
  open: boolean;
  toggle: () => void;
}
const SearchCtx = createContext<Ctx | null>(null);

export function MobileSearchShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      if (next) setTimeout(() => inputRef.current?.focus(), 50);
      else setQ('');
      return next;
    });
  };
  const close = () => {
    setOpen(false);
    setQ('');
  };
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = q.trim();
    if (t) {
      router.push(`/search?q=${encodeURIComponent(t)}`);
      close();
    }
  };

  return (
    <SearchCtx.Provider value={{ open, toggle }}>
      {children}
      {open && (
        <div className="flex h-11 items-center border-t border-white/10 px-4 text-white md:hidden">
          <form onSubmit={onSubmit} className="flex w-full items-center gap-2">
            <Search className="h-4 w-4 shrink-0 text-white/70" aria-hidden="true" />
            <input
              ref={inputRef}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="会員名 / ID / メール などで検索"
              className="flex-1 bg-transparent text-base text-white placeholder:text-white/50 focus:outline-none"
            />
            <button
              type="button"
              onClick={close}
              className="text-white/70 hover:text-white"
              aria-label="閉じる"
            >
              <X className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </SearchCtx.Provider>
  );
}

/** ヘッダー内容行に置く検索トグルボタン(mdで非表示)。 */
export function MobileSearchToggleButton() {
  const ctx = useContext(SearchCtx);
  if (!ctx) return null;
  return (
    <button
      type="button"
      aria-label="検索"
      onClick={ctx.toggle}
      className="grid h-8 w-8 place-items-center rounded text-white/90 hover:bg-white/10 hover:text-white md:hidden"
    >
      {ctx.open ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
    </button>
  );
}
