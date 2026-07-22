'use client';

/**
 * レポート一覧のページ内検索ボックス。
 * 入力を 300ms デバウンスして URL の ?q= を更新する(他のフィルタ条件は維持)。
 */

import { Search, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export function ReportsSearchBox({ initialQ }: { initialQ: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initialQ);
  // 初回マウント時は URL 更新しない(initialQ と一致しているため)
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const handle = setTimeout(() => {
      const p = new URLSearchParams(searchParams?.toString() ?? '');
      const t = value.trim();
      if (t) p.set('q', t);
      else p.delete('q');
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, 300);
    return () => clearTimeout(handle);
    // searchParams / pathname は URL 変化のたびに変わるが、ここでは value の変化のみを契機にする
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative w-full sm:max-w-xs">
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="レポート名・説明で検索"
        aria-label="レポート内検索"
        className="h-8 w-full rounded border bg-background pl-8 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      {value && (
        <button
          type="button"
          onClick={() => setValue('')}
          aria-label="クリア"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
