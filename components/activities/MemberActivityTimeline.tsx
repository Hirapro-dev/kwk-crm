'use client';

import { ActivityTimeline } from '@/components/activities/ActivityTimeline';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { LIST_PAGE_SIZE } from '@/lib/domain/list_constants';
import { loadActivitiesPage } from '@/lib/domain/list_more_actions';
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
 * 2026-09-16: 接触種別・状態・期間で絞り込めるようにした(メール由来の対応歴が増えたため、
 * 架電や面談などの過去の対応を見やすくする)。絞り込みはサーバー側(listActivities)で行い、
 * 変えるたびに先頭ページを読み直す。
 *
 * IntersectionObserver の root は指定しない(=ビューポート)。
 * 会員詳細は全画面表示のほか、会員一覧・対応歴一覧の分割ビューの右ペイン
 * (独自のスクロール領域)にも埋め込まれるため、どちらでも動くようにする。
 */
interface Props {
  memberId: string;
  /** サーバー側で取得済みの先頭ページ(LIST_PAGE_SIZE 件。絞り込みなし) */
  initialRows: ActivityListItem[];
  /** 絞り込みなしの総件数 */
  total: number;
  currentUserId: string;
  currentUserRole: string;
  /** 接触種別の選択肢(既存データの分類) */
  bunruiList?: string[];
}

/** 状態(s_bunrui)の選択肢。パイプ区切りで格納されるため部分一致で絞る。受信/送信はメール由来の対応歴 */
const STATUS_OPTIONS = ['通電', '不在', '接触対応', '申込獲得', '受信', '送信'] as const;

interface Filters {
  dBunrui: string;
  sBunrui: string;
  from: string;
  to: string;
}
const EMPTY_FILTERS: Filters = { dBunrui: '', sBunrui: '', from: '', to: '' };

function toParams(memberId: string, f: Filters) {
  return {
    memberId,
    dBunrui: f.dBunrui || undefined,
    sBunrui: f.sBunrui || undefined,
    from: f.from || undefined,
    // 終了日はその日の終わりまで含める
    to: f.to ? `${f.to}T23:59:59.999` : undefined,
  };
}

export function MemberActivityTimeline({
  memberId,
  initialRows,
  total,
  currentUserId,
  currentUserRole,
  bunruiList = [],
}: Props) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const filtering =
    filters.dBunrui !== '' || filters.sBunrui !== '' || filters.from !== '' || filters.to !== '';
  const [rows, setRows] = useState<ActivityListItem[]>(initialRows);
  const [filteredTotal, setFilteredTotal] = useState(total);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(initialRows.length >= total);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);
  // 絞り込みを連続して変えたとき、古い応答で新しい表示を上書きしないための連番
  const requestSeq = useRef(0);

  // 対応歴の登録・編集・削除のあと ActivityTimeline / ActivityFormCard が
  // router.refresh() するため、サーバーから新しい先頭ページが渡ってくる。
  // 絞り込み中でなければ、読み込み済みの続きを破棄して先頭ページに戻す。
  // (古い続きを残すと、削除で件数がずれた状態のまま追記されてしまう)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 絞り込み中は initialRows の更新に追従しない(自前で読み直す)
  useEffect(() => {
    if (filtering) return;
    setRows(initialRows);
    setFilteredTotal(total);
    setPage(1);
    setDone(initialRows.length >= total);
    loadingRef.current = false;
  }, [initialRows, total]);

  // 絞り込みを変えたら先頭ページを読み直す(解除時は初期の先頭ページに戻す)
  // biome-ignore lint/correctness/useExhaustiveDependencies: filters が変わったときだけ読み直す
  useEffect(() => {
    const seq = ++requestSeq.current;
    setError(null);
    if (!filtering) {
      setRows(initialRows);
      setFilteredTotal(total);
      setPage(1);
      setDone(initialRows.length >= total);
      return;
    }
    setLoading(true);
    void (async () => {
      try {
        const r = await loadActivitiesPage(toParams(memberId, filters), 1);
        if (seq !== requestSeq.current) return;
        setRows(r.rows);
        setFilteredTotal(r.total);
        setPage(1);
        setDone(r.rows.length >= r.total);
      } catch (e) {
        if (seq !== requestSeq.current) return;
        setError(e instanceof Error ? e.message : '読み込みに失敗しました');
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    })();
  }, [filters]);

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
            const r = await loadActivitiesPage(toParams(memberId, filters), page + 1);
            const next = r.rows;
            setRows((prev) => {
              const merged = [...prev, ...next];
              // 取得件数が1ページ未満、または総件数に達したら打ち止め
              if (next.length < LIST_PAGE_SIZE || merged.length >= r.total) setDone(true);
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
  }, [page, done, memberId, filters]);

  const remaining = Math.max(0, filteredTotal - rows.length);
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const bunruiOptions = [...new Set(bunruiList)];

  return (
    <div className="min-w-0">
      {/* 絞り込み: 接触種別 / 状態 / 期間 */}
      <div className="mb-2 flex flex-wrap items-end gap-2 text-xs">
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground">接触種別</span>
          <Select
            value={filters.dBunrui}
            onChange={(e) => set({ dBunrui: e.target.value })}
            className="h-8 text-xs"
            aria-label="接触種別で絞り込み"
          >
            <option value="">すべて</option>
            {bunruiOptions.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground">状態</span>
          <Select
            value={filters.sBunrui}
            onChange={(e) => set({ sBunrui: e.target.value })}
            className="h-8 text-xs"
            aria-label="状態で絞り込み"
          >
            <option value="">すべて</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground">期間(から)</span>
          <Input
            type="date"
            value={filters.from}
            onChange={(e) => set({ from: e.target.value })}
            className="h-8 text-xs"
            aria-label="期間の開始日"
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground">期間(まで)</span>
          <Input
            type="date"
            value={filters.to}
            onChange={(e) => set({ to: e.target.value })}
            className="h-8 text-xs"
            aria-label="期間の終了日"
          />
        </div>
        {filtering && (
          <button
            type="button"
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="h-8 rounded border px-2 text-xs hover:bg-accent"
          >
            解除
          </button>
        )}
        {filtering && !loading && (
          <span className="text-muted-foreground">
            絞り込み: {filteredTotal.toLocaleString()} 件
          </span>
        )}
      </div>
      {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
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
