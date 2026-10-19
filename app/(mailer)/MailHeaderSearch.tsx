'use client';

import { Search } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * メーラーのヘッダーの検索欄(CLAUDE.md §5.15「検索」/ migration 125)。
 * すべての受信箱を対象に探す(受信箱・フォルダの指定は外す)。メールアドレスを入れると、
 * そのアドレスが差出人・宛先・CC に入っているやり取りを、自社のどの送信元のものも含めて全部出す。
 * それ以外の言葉は件名・差出人・本文から探す。フォルダ内だけを探すときは一覧の上の検索欄を使う。
 */
export function MailHeaderSearch() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // 全受信箱の検索結果を見ているときだけ、今の検索語を入れておく
  const current =
    searchParams.get('box') || searchParams.get('folder') ? '' : (searchParams.get('q') ?? '');
  const [q, setQ] = useState(current);
  useEffect(() => setQ(current), [current]);

  return (
    <form
      className="mx-auto hidden w-full max-w-md items-center md:flex"
      onSubmit={(e) => {
        e.preventDefault();
        const v = q.trim();
        router.push(v ? `/mail?q=${encodeURIComponent(v)}` : '/mail');
      }}
    >
      <div className="relative w-full">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/60"
          aria-hidden="true"
        />
        <input
          type="search"
          aria-label="すべての受信箱から検索"
          placeholder="すべての受信箱から検索(メールアドレス・件名・本文)"
          className="h-8 w-full rounded bg-white/15 pl-8 pr-2 text-xs text-white placeholder:text-white/60 focus:bg-white/25 focus:outline-none"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
    </form>
  );
}
