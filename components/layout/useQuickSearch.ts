'use client';

/**
 * ヘッダー検索ボックスのインクリメンタル検索フック。
 * 入力 q を 250ms デバウンスして quickSearch(Server Action) を呼び、候補を返す。
 * 入力が変わった場合は前のリクエスト結果を破棄し、常に最新の入力に対応する候補のみ反映する。
 */

import { quickSearch, type QuickSearchItem } from '@/lib/domain/search_actions';
import { useEffect, useState } from 'react';

export function useQuickSearch(q: string): { items: QuickSearchItem[]; loading: boolean } {
  const [items, setItems] = useState<QuickSearchItem[]>([]);
  const [loading, setLoading] = useState(false);

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
        const res = await quickSearch(t);
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

  return { items, loading };
}
