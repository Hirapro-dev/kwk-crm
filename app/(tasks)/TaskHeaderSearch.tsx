'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * タスク管理のヘッダーの検索欄(2026-10-02)。Enter で検索ページ(/task/search?q=。タスク名・プロジェクト名の部分一致)を開く。
 * PC は欄を出し、スマホ(md 未満)は場所が狭いので虫眼鏡アイコンから検索ページへ移る(下タブの「検索」と同じ)。
 */
export function TaskHeaderSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  return (
    <>
      <form
        className="relative hidden w-full max-w-md md:block"
        onSubmit={(e) => {
          e.preventDefault();
          const t = q.trim();
          router.push(t ? `/task/search?q=${encodeURIComponent(t)}` : '/task/search');
        }}
      >
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/60"
          aria-hidden="true"
        />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="タスク名・プロジェクト名で検索"
          aria-label="タスクを検索"
          className="h-8 w-full rounded-md border border-white/20 bg-white/10 pl-8 pr-3 text-sm text-white placeholder:text-white/60 focus:border-white/40 focus:bg-white/15 focus:outline-none"
        />
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
