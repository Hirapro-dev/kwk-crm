'use client';

import { ActivityTimeline } from '@/components/activities/ActivityTimeline';
import { LIST_PAGE_SIZE } from '@/lib/domain/list_constants';
import { loadMoreActivities } from '@/lib/domain/list_more_actions';
import type { ActivityListItem } from '@/lib/domain/types';
import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * 対応歴の無限スクロール表示。
 * 既存の ActivityTimeline(編集機能つき)をそのまま使い、下端センチネルが
 * 見えたら次ページを取得して行を追記する。
 * フィルタ/ソート変更時は呼び出し側で key を変えて再マウントすること。
 *
 * スクロール位置の復元:
 *   会員名クリックで顧客詳細へフルページ遷移し、対応歴登録などをして一覧に
 *   戻る/リロードすると、クライアント状態が初期化されて先頭に戻ってしまう。
 *   これを防ぐため、離脱・リロード直前に「読み込み済みページ数」と
 *   「スクロール位置」を sessionStorage(フィルタ条件ごと)に保存し、
 *   再マウント時に同じページ数まで再取得してから位置を復元する。
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
  /** 分割ビュー: 会員名クリックで右ペインに詳細を出す */
  splitMode?: boolean;
  /** 分割ビューで現在選択中の会員ID */
  selectedMemberId?: string;
}

/** 復元時に再取得するページ数の上限(暴走防止。50件 × 40 = 2000件まで復元) */
const MAX_RESTORE_PAGES = 40;

export function ActivitiesInfinite({
  initialRows,
  total,
  currentUserId,
  currentUserRole,
  params,
  splitMode,
  selectedMemberId,
}: Props) {
  const [rows, setRows] = useState<ActivityListItem[]>(initialRows);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(initialRows.length >= total);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);
  // 分割ビュー時のスクロールコンテナ(通常ビューは window がスクローラ)
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // 復元処理を一度だけ行うためのガード
  const restoredRef = useRef(false);
  // 保存クロージャから最新ページ数を参照するための ref
  const pageRef = useRef(1);
  pageRef.current = page;

  // フィルタ条件ごとに一意な保存キー(会員選択で変わる selectedMemberId は含めない)
  const storageKey = useMemo(
    () => `activities-scroll:${splitMode ? 'split' : 'list'}:${JSON.stringify(params)}`,
    [params, splitMode],
  );

  // 現在のスクロール位置を取得/設定(モードにより対象が異なる)
  const getScrollOffset = () =>
    splitMode ? (wrapperRef.current?.scrollTop ?? 0) : (window.scrollY ?? 0);
  const setScrollOffset = (y: number) => {
    if (splitMode) {
      if (wrapperRef.current) wrapperRef.current.scrollTop = y;
    } else {
      window.scrollTo(0, y);
    }
  };

  // 無限スクロール(下端センチネル監視)
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

  // マウント時: 保存済みの位置があれば同じページ数まで再取得して復元する
  // biome-ignore lint/correctness/useExhaustiveDependencies: マウント時のみ実行する復元処理
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(storageKey);
    } catch {
      return;
    }
    if (!raw) return;
    let saved: { page?: number; offset?: number };
    try {
      saved = JSON.parse(raw);
    } catch {
      return;
    }
    const targetPage = Math.min(MAX_RESTORE_PAGES, Math.max(1, saved.page ?? 1));
    const offset = Math.max(0, saved.offset ?? 0);

    // 2フレーム待って描画確定後にスクロール位置を戻す
    const restoreScroll = () => {
      requestAnimationFrame(() => requestAnimationFrame(() => setScrollOffset(offset)));
    };

    if (targetPage <= 1 || initialRows.length >= total) {
      restoreScroll();
      return;
    }

    loadingRef.current = true;
    setLoading(true);
    void (async () => {
      try {
        let merged = initialRows;
        let p = 1;
        let reachedEnd = merged.length >= total;
        while (p < targetPage && !reachedEnd) {
          p += 1;
          const next = await loadMoreActivities(params, p);
          merged = [...merged, ...next];
          if (next.length < LIST_PAGE_SIZE || merged.length >= total) reachedEnd = true;
        }
        setRows(merged);
        setPage(p);
        if (reachedEnd) setDone(true);
        restoreScroll();
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    })();
  }, []);

  // 離脱/リロード直前に現在の位置を保存する
  // biome-ignore lint/correctness/useExhaustiveDependencies: getScrollOffset は毎レンダー再生成される安定処理のため除外
  useEffect(() => {
    const save = () => {
      try {
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({ page: pageRef.current, offset: getScrollOffset() }),
        );
      } catch {
        // sessionStorage 使用不可(容量超過など)は無視
      }
    };
    const scroller: Window | HTMLElement | null = splitMode ? wrapperRef.current : window;
    if (!scroller) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(save, 150);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('beforeunload', save);
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      window.removeEventListener('beforeunload', save);
      clearTimeout(timer);
      // アンマウント(顧客詳細への遷移など)直前に最終位置を保存
      save();
    };
  }, [storageKey, splitMode]);

  return (
    <div ref={wrapperRef} className={splitMode ? 'min-h-0 flex-1 overflow-y-auto p-2' : 'p-2'}>
      <ActivityTimeline
        activities={rows}
        currentUserId={currentUserId}
        currentUserRole={currentUserRole}
        showMember
        splitMode={splitMode}
        selectedMemberId={selectedMemberId}
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
