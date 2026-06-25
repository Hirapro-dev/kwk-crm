'use client';

import { Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

/**
 * モバイル専用の検索トグル。
 * 虫眼鏡アイコンをタップするとヘッダー下部に検索バーが展開する。
 * md 以上では非表示 (md:hidden)。
 */
export function MobileSearchToggle() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleOpen = () => {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleClose = () => {
    setOpen(false);
    setQ('');
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = q.trim();
    if (t) {
      router.push(`/search?q=${encodeURIComponent(t)}`);
      handleClose();
    }
  };

  return (
    <>
      {/* 虫眼鏡ボタン (常時表示) */}
      <button
        type="button"
        aria-label="検索"
        onClick={open ? handleClose : handleOpen}
        className="grid h-8 w-8 place-items-center rounded text-white/90 hover:bg-white/10 hover:text-white md:hidden"
      >
        {open ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
      </button>

      {/*
        展開した検索バー: ヘッダー(relative)の実際の下端に top-full で吸着させる。
        env(safe-area-inset-top) を手計算しないため、端末ごとのセーフエリア差でズレない。
      */}
      {open && (
        <div className="absolute inset-x-0 top-full z-[100] flex h-11 items-center bg-[hsl(var(--sf-header))] px-4 text-white shadow-md md:hidden">
          <form onSubmit={onSubmit} className="flex w-full items-center gap-2">
            <Search className="h-4 w-4 shrink-0 text-white/70" aria-hidden="true" />
            <input
              ref={inputRef}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="会員名 / ID / メール などで検索"
              className="flex-1 bg-transparent text-sm text-white placeholder:text-white/50 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleClose}
              className="text-white/70 hover:text-white"
              aria-label="閉じる"
            >
              <X className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
