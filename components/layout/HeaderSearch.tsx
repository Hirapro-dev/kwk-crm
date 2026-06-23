'use client';

/**
 * ヘッダーの全体検索ボックス。
 * Enter(送信)で /search?q=... に遷移し、会員/問合せ/申込を横断検索する。
 */

import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function HeaderSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = q.trim();
    if (t) router.push(`/search?q=${encodeURIComponent(t)}`);
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
        onChange={(e) => setQ(e.target.value)}
        placeholder="検索... (会員/問合せ/申込)"
        aria-label="全体検索"
        className="h-8 w-full rounded border-0 bg-white/95 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-white"
      />
    </form>
  );
}
