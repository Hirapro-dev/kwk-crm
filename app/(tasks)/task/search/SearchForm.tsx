'use client';

import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** 検索欄(Enter で ?q= を付けて再読込。サーバー側で検索する) */
export function SearchForm({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);
  return (
    <form
      className="relative"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(q.trim() ? `/task/search?q=${encodeURIComponent(q.trim())}` : '/task/search');
      }}
    >
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="タスク名・プロジェクト名で検索"
        aria-label="検索"
        className="h-11 rounded-full bg-white pl-9 text-base md:h-9 md:text-sm"
        autoFocus={!initialQuery}
      />
    </form>
  );
}
