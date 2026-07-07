'use client';

/**
 * 無限スクロール対応の汎用テーブル。
 * 下端のセンチネルが見えたら loadMore(次ページ) を呼んで行を追記する。
 * ヘッダーは sortField 指定で SortHeader(昇順/降順)になる。
 * フィルタ/ソート変更時は呼び出し側で key を変えて再マウントすること。
 */

import { SortHeader } from '@/components/layout/SortHeader';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils/cn';
import { useEffect, useRef, useState } from 'react';
import { ColumnResizeHandle, useColumnResize } from './useColumnResize';

/** 内部スクロール領域の既定の高さ(sticky ヘッダーを効かせるため一覧自体をスクロール領域にする) */
const DEFAULT_SCROLL_AREA = 'max-h-[calc(100dvh-13.5rem)]';

export interface InfiniteCol {
  header: string;
  /** 指定すると昇順/降順ソート可能なヘッダーになる(DBカラム名) */
  sortField?: string;
  headClassName?: string;
}

export function InfiniteTable<T>({
  initialRows,
  total,
  pageSize,
  loadMore,
  columns,
  renderRow,
  getKey,
  emptyMessage,
  rowClassName,
  fillParent,
}: {
  initialRows: T[];
  total: number;
  pageSize: number;
  /** 次ページの行を返す(Server Action) */
  loadMore: (page: number) => Promise<T[]>;
  columns: InfiniteCol[];
  /** 1行分のセル(<TableCell>...)を返す */
  renderRow: (row: T) => React.ReactNode;
  getKey: (row: T, index: number) => string;
  emptyMessage: string;
  /** 行ごとの追加クラス(分割ビューの選択行ハイライト等)。省略時は既定のみ。 */
  rowClassName?: (row: T, index: number) => string | undefined;
  /**
   * 親の高さいっぱいをスクロール領域にする(分割ビュー等、親が固定高さのとき)。
   * true のとき: 親は flex-col で高さを持たせること。既定(false)は DEFAULT_SCROLL_AREA の高さ。
   */
  fillParent?: boolean;
}) {
  const [rows, setRows] = useState<T[]>(initialRows);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(initialRows.length >= total);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // 一覧自体をスクロール領域にし、その中で sticky ヘッダーと無限スクロール監視を行う
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;

  // --- 列幅ドラッグ調整 ---
  // 列キー(ラベル/フィールド名)で識別。storageKey は列構成で一意(オブジェクトごとに別).
  const colKeys = columns.map((c, i) => c.sortField ?? c.header ?? String(i));
  const { widths, allSeeded, onResizeStart, seedMissing } = useColumnResize(
    `crm.colw.list:${colKeys.join('|')}`,
  );
  const tableRef = useRef<HTMLTableElement | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 列構成が変わったときだけ再計測
  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    const ths = table.querySelectorAll('thead th');
    const m: Record<string, number> = {};
    ths.forEach((th, i) => {
      const k = colKeys[i];
      if (k) m[k] = (th as HTMLElement).offsetWidth;
    });
    seedMissing(m);
  }, [colKeys.join('|'), seedMissing]);
  const fixed = allSeeded(colKeys);
  const totalWidth = fixed ? colKeys.reduce((s, k) => s + (widths[k] ?? 0), 0) : undefined;

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
            const next = await loadMoreRef.current(page + 1);
            setRows((prev) => {
              const merged = [...prev, ...next];
              if (next.length < pageSize || merged.length >= total) setDone(true);
              return merged;
            });
            setPage((p) => p + 1);
          } catch {
            setDone(true);
          } finally {
            loadingRef.current = false;
            setLoading(false);
          }
        })();
      },
      { root: scrollRef.current, rootMargin: '300px' },
    );
    io.observe(el);
    return () => io.disconnect();
    // root は scrollRef(スクロール領域)。マウント後に ref が入るため deps に含めない。
  }, [page, done, total, pageSize]);

  return (
    // fillParent 時は親(flex-col・固定高さ)いっぱいを占め、内側でスクロールさせる
    <div className={cn(fillParent && 'flex min-h-0 flex-1 flex-col')}>
      {/* 一覧自体をスクロール領域にして、ヘッダー行を sticky で固定する。
          wrapperClassName=overflow-visible で内側に二重スクロールを作らない。 */}
      <div
        ref={scrollRef}
        className={cn('overflow-auto', fillParent ? 'min-h-0 flex-1' : DEFAULT_SCROLL_AREA)}
      >
        <Table
          ref={tableRef}
          wrapperClassName="overflow-visible"
          className={cn(
            // fixed レイアウト時は各セルをはみ出さず省略表示(…)にする
            fixed && '[&_td]:overflow-hidden [&_td]:text-ellipsis [&_th]:overflow-hidden',
          )}
          style={fixed ? { tableLayout: 'fixed', width: totalWidth } : undefined}
        >
          <colgroup>
            {colKeys.map((k) => (
              <col key={k} style={{ width: widths[k] }} />
            ))}
          </colgroup>
          <TableHeader>
            <TableRow className="bg-gray-50 hover:bg-gray-50">
              {columns.map((c, i) => {
                const k = colKeys[i] ?? String(i);
                return (
                  <TableHead
                    key={c.header}
                    className={cn(
                      'sticky top-0 z-20 bg-gray-50 relative',
                      c.headClassName ?? 'h-9 whitespace-nowrap',
                    )}
                  >
                    {c.sortField ? <SortHeader field={c.sortField} label={c.header} /> : c.header}
                    <ColumnResizeHandle onStart={(w, e) => onResizeStart(k, w, e)} />
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="py-6 text-center text-sm text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r, i) => (
                <TableRow
                  key={getKey(r, i)}
                  className={`sf-row-hover ${rowClassName?.(r, i) ?? ''}`}
                >
                  {renderRow(r)}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {/* センチネルはスクロール領域の内側に置く(監視ルート=scrollRef のため) */}
        <div ref={sentinelRef} aria-hidden="true" />
      </div>
      {rows.length > 0 && (
        <div className="py-3 text-center text-xs text-muted-foreground">
          {loading
            ? '読み込み中…'
            : done
              ? `全 ${total.toLocaleString()} 件を表示`
              : `${rows.length.toLocaleString()} / ${total.toLocaleString()} 件`}
        </div>
      )}
    </div>
  );
}
