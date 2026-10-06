'use client';

import { type TaskQuickSearchItem, quickSearchTasks } from '@/lib/domain/task_actions';
import { CheckCircle2, Circle, ListTodo, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * タスク管理のヘッダーの検索欄(2026-10-02)。入力中にプロジェクト・タスクの候補を出し(quickSearchTasks。250ms 待ってから問い合わせ)、
 * クリック / ↑↓ + Enter でそのページへ。候補を選ばずに Enter なら検索ページ(/task/search?q=)を開く。CRM のヘッダー検索(HeaderSearch)と同じ操作。
 * スマホ(md 未満)は場所が狭いので虫眼鏡アイコンから検索ページへ移る(下タブの「検索」と同じ)。
 */
export function TaskHeaderSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [items, setItems] = useState<TaskQuickSearchItem[]>([]);
  const [loading, setLoading] = useState(false);

  // 入力が変わったら前の結果は捨て、最新の入力の候補だけ反映する
  useEffect(() => {
    const t = q.trim();
    if (!t) {
      setItems([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await quickSearchTasks(t);
        if (!cancelled) setItems(res);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [q]);

  const showDropdown = focused && q.trim().length > 0;

  const go = (href: string) => {
    router.push(href);
    setQ('');
    setActiveIndex(-1);
    setFocused(false);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const picked = activeIndex >= 0 ? items[activeIndex] : undefined;
    if (picked) return go(picked.href);
    const t = q.trim();
    go(t ? `/task/search?q=${encodeURIComponent(t)}` : '/task/search');
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
    <>
      <form onSubmit={onSubmit} className="relative hidden w-full max-w-md md:block">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/60"
          aria-hidden="true"
        />
        <input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActiveIndex(-1);
            setFocused(true);
          }}
          onFocus={() => setFocused(true)}
          // 候補のクリック(onMouseDown)を先に処理させるため、閉じるのを少し遅らせる
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          onKeyDown={onKeyDown}
          placeholder="タスク名・プロジェクト名で検索"
          aria-label="タスクを検索"
          autoComplete="off"
          className="h-8 w-full rounded-md border border-white/20 bg-white/10 pl-8 pr-3 text-sm text-white placeholder:text-white/60 focus:border-white/40 focus:bg-white/15 focus:outline-none"
        />
        {showDropdown && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[70vh] overflow-auto rounded-md border bg-white py-1 text-left text-foreground shadow-lg">
            {items.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                {loading ? '検索中…' : '該当するプロジェクト・タスクが見つかりません'}
              </div>
            ) : (
              items.map((it, i) => (
                <button
                  key={it.href}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    go(it.href);
                  }}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`flex w-full items-start gap-2 px-3 py-2 text-left ${
                    i === activeIndex ? 'bg-accent' : 'hover:bg-accent/50'
                  }`}
                >
                  {it.kind === 'project' ? (
                    <ListTodo
                      className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  ) : it.completed ? (
                    <CheckCircle2
                      className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
                      aria-hidden="true"
                    />
                  ) : (
                    <Circle
                      className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span
                        className={`truncate text-sm font-medium ${it.completed ? 'text-muted-foreground line-through' : ''}`}
                      >
                        {it.title}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {it.kind === 'project' ? 'プロジェクト' : 'タスク'}
                      </span>
                    </span>
                    {it.sub && (
                      <span className="block truncate text-xs text-muted-foreground">{it.sub}</span>
                    )}
                  </span>
                </button>
              ))
            )}
            {/* 候補にない分は検索ページで全件(タスク 50 件まで)を見る */}
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                go(`/task/search?q=${encodeURIComponent(q.trim())}`);
              }}
              className="block w-full border-t px-3 py-2 text-left text-xs text-primary hover:bg-accent/50"
            >
              「{q.trim()}」で検索ページを開く
            </button>
          </div>
        )}
      </form>
      <Link
        href="/task/search"
        aria-label="タスクを検索"
        title="検索"
        className="grid h-8 w-8 place-items-center rounded text-white/90 hover:bg-white/10 md:hidden"
      >
        <Search className="h-5 w-5" aria-hidden="true" />
      </Link>
    </>
  );
}
