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
import { useEffect, useRef, useState } from 'react';

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
}) {
  const [rows, setRows] = useState<T[]>(initialRows);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(initialRows.length >= total);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;

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
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [page, done, total, pageSize]);

  return (
    <div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50 hover:bg-gray-50">
              {columns.map((c) => (
                <TableHead key={c.header} className={c.headClassName ?? 'h-9 whitespace-nowrap'}>
                  {c.sortField ? <SortHeader field={c.sortField} label={c.header} /> : c.header}
                </TableHead>
              ))}
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
                <TableRow key={getKey(r, i)} className="sf-row-hover">
                  {renderRow(r)}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <div ref={sentinelRef} aria-hidden="true" />
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
