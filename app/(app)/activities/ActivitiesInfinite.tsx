'use client';

import { ActivityTimeline } from '@/components/activities/ActivityTimeline';
import { LIST_PAGE_SIZE } from '@/lib/domain/list_constants';
import { loadMoreActivities } from '@/lib/domain/list_more_actions';
import type { ActivityListItem } from '@/lib/domain/types';
import { useEffect, useRef, useState } from 'react';

/**
 * 対応歴の無限スクロール表示。
 * 既存の ActivityTimeline(編集機能つき)をそのまま使い、下端センチネルが
 * 見えたら次ページを取得して行を追記する。
 * フィルタ/ソート変更時は呼び出し側で key を変えて再マウントすること。
 */
interface Props {
  initialRows: ActivityListItem[];
  total: number;
  currentUserId: string;
  currentUserRole: string;
  params: {
    memberId?: string;
    ownerId?: string;
    dBunrui?: string;
    from?: string;
    to?: string;
  };
}

export function ActivitiesInfinite({
  initialRows,
  total,
  currentUserId,
  currentUserRole,
  params,
}: Props) {
  const [rows, setRows] = useState<ActivityListItem[]>(initialRows);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(initialRows.length >= total);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || done) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || loadingRef.current || done) return;
        loadingRef.current = true;
        setLoading(true);
        void (async () => {
          try {
            const next = await loadMoreActivities(params, page + 1);
            setRows((prev) => {
              const merged = [...prev, ...next];
              if (next.length < LIST_PAGE_SIZE || merged.length >= total) setDone(true);
              return merged;
            });
            setPage((p) => p + 1);
          } finally {
            loadingRef.current = false;
            setLoading(false);
          }
        })();
      },
      { rootMargin: '400px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [page, done, total, params]);

  return (
    <div className="p-2">
      <ActivityTimeline
        activities={rows}
        currentUserId={currentUserId}
        currentUserRole={currentUserRole}
        showMember
      />
      {!done && (
        <div ref={sentinelRef} className="py-4 text-center text-xs text-muted-foreground">
          {loading ? '読み込み中…' : 'スクロールで続きを表示'}
        </div>
      )}
      <p className="py-2 text-center text-[11px] text-muted-foreground">
        {rows.length.toLocaleString()} / {total.toLocaleString()} 件
      </p>
    </div>
  );
}
