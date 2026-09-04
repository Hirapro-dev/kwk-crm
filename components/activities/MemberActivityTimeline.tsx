'use client';

import { ActivityTimeline } from '@/components/activities/ActivityTimeline';
import { LIST_PAGE_SIZE } from '@/lib/domain/list_constants';
import { loadMoreActivities } from '@/lib/domain/list_more_actions';
import type { ActivityListItem } from '@/lib/domain/types';
import { useEffect, useRef, useState } from 'react';

/**
 * 会員詳細の対応歴を無限スクロールで表示する。
 *
 * 背景: 従来は先頭 50 件を取得して並べるだけで、51 件目以降に到達する手段が
 * なかった(カード右上には全件数が出るため「250件」と表示されて 50 件しか
 * 並ばない状態になっていた)。
 *
 * 表示は既存の ActivityTimeline(編集・削除つき)をそのまま使い、
 * 下端のセンチネルが見えたら次ページを取得して追記する。
 * これは対応歴一覧(ActivitiesInfinite)や共通テーブル(InfiniteTable)と同じ方式。
 *
 * IntersectionObserver の root は指定しない(=ビューポート)。
 * 会員詳細は全画面表示のほか、会員一覧・対応歴一覧の分割ビューの右ペイン
 * (独自のスクロール領域)にも埋め込まれるため、どちらでも動くようにする。
 */
interface Props {
  memberId: string;
  /** サーバー側で取得済みの先頭ページ(LIST_PAGE_SIZE 件) */
  initialRows: ActivityListItem[];
  /** 絞り込み後の総件数 */
  total: number;
  currentUserId: string;
  currentUserRole: string;
}

export function MemberActivityTimeline({
  memberId,
  initialRows,
  total,
  currentUserId,
  currentUserRole,
}: Props) {
  const [rows, setRows] = useState<ActivityListItem[]>(initialRows);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(initialRows.length >= total);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);

  // 対応歴の登録・編集・削除のあと ActivityTimeline / ActivityFormCard が
  // router.refresh() するため、サーバーから新しい先頭ページが渡ってくる。
  // そのときは読み込み済みの続きを破棄して先頭ページに戻す。
  // (古い続きを残すと、削除で件数がずれた状態のまま追記されてしまう)
  useEffect(() => {
    setRows(initialRows);
    setPage(1);
    setDone(initialRows.length >= total);
    loadingRef.current = false;
  }, [initialRows, total]);

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
            const next = await loadMoreActivities({ memberId }, page + 1);
            setRows((prev) => {
              const merged = [...prev, ...next];
              // 取得件数が1ページ未満、または総件数に達したら打ち止め
              if (next.length < LIST_PAGE_SIZE || merged.length >= total) setDone(true);
              return merged;
            });
            setPage((p) => p + 1);
          } catch {
            // 追加取得に失敗したら無限リトライせず止める(表示済みぶんは残す)
            setDone(true);
          } finally {
            loadingRef.current = false;
            setLoading(false);
          }
        })();
      },
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [page, done, total, memberId]);

  const remaining = Math.max(0, total - rows.length);

  return (
    <div className="min-w-0">
      <ActivityTimeline
        activities={rows}
        currentUserId={currentUserId}
        currentUserRole={currentUserRole}
      />
      {!done && (
        <div ref={sentinelRef} className="py-3 text-center text-xs text-muted-foreground">
          {loading
            ? '読み込み中…'
            : `スクロールでさらに表示 (残り ${remaining.toLocaleString()} 件)`}
        </div>
      )}
      {done && rows.length > LIST_PAGE_SIZE && (
        <div className="py-3 text-center text-xs text-muted-foreground">
          全 {rows.length.toLocaleString()} 件を表示しました
        </div>
      )}
    </div>
  );
}
