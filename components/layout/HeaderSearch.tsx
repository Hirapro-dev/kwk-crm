'use client';

/**
 * ヘッダーの全体検索ボックス(PC)。
 * 入力に応じて候補レコードをドロップダウン表示し、クリック/Enter で詳細ページへ遷移する。
 * 候補が選択されていない状態の Enter は従来通り /search?q=... の全体検索へフォールバックする。
 */

import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuickSearch } from './useQuickSearch';

export function HeaderSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const { items, loading } = useQuickSearch(q);

  const showDropdown = focused && q.trim().length > 0;

  const go = (href: string) => {
    router.push(href);
    setQ('');
    setActiveIndex(-1);
    setFocused(false);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeIndex >= 0 && items[activeIndex]) {
      go(items[activeIndex].href);
      return;
    }
    const t = q.trim();
    if (t) {
      router.push(`/search?q=${encodeURIComponent(t)}`);
      setQ('');
      setActiveIndex(-1);
      setFocused(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || items.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(-1, i - 1));
    } else if (e.key === 'Escape') {
      setFocused(false);
      setActiveIndex(-1);
    }
  };

  return (
    <form onSubmit={onSubmit} className="relative w-full" role="search">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActiveIndex(-1);
        }}
        onFocus={() => setFocused(true)}
        // クリックによる遷移(onMouseDown)を先に処理させるため、blur は少し遅延させて閉じる
        onBlur={() => setTimeout(() => setFocused(false), 120)}
        onKeyDown={onKeyDown}
        placeholder="検索... (会員/問合せ/申込)"
        aria-label="全体検索"
        autoComplete="off"
        className="h-8 w-full rounded border-0 bg-white/95 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-white"
      />

      {showDropdown && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[70vh] overflow-auto rounded-md border bg-white py-1 text-left shadow-lg">
          {items.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              {loading ? '検索中…' : '該当するレコードが見つかりません'}
            </div>
          ) : (
            items.map((it, i) => (
              <button
                key={`${it.kind}:${it.href}`}
                type="button"
                // blur より先に発火させて遷移するため onMouseDown を使う
                onMouseDown={(e) => {
                  e.preventDefault();
                  go(it.href);
                }}
                onMouseEnter={() => setActiveIndex(i)}
                className={`block w-full px-3 py-2 text-left ${
                  i === activeIndex ? 'bg-accent' : 'hover:bg-accent/50'
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{it.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{it.objectLabel}</span>
                </div>
                {it.sub && (
                  <div className="truncate text-xs text-muted-foreground">{it.sub}</div>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </form>
  );
}
