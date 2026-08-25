'use client';

/**
 * 無限スクロール対応の汎用テーブル。
 * 下端のセンチネルが見えたら loadMore(次ページ) を呼んで行を追記する。
 * ヘッダーは sortField 指定で SortHeader(昇順/降順)になる。
 * フィルタ/ソート変更時は呼び出し側で key を変えて再マウントすること。
 */

import { DeleteConfirmDialog } from '@/components/layout/DeleteConfirmDialog';
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
import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ColumnResizeHandle, useColumnResize } from './useColumnResize';

/** 内部スクロール領域の既定の高さ(sticky ヘッダーを効かせるため一覧自体をスクロール領域にする) */
const DEFAULT_SCROLL_AREA = 'max-h-[calc(100dvh-13.5rem)]';

/** 選択列(チェックボックス+削除ボタン)の列キー。列幅は固定でリサイズ対象外。 */
const SELECT_COL_KEY = '__select__';

/**
 * 削除後に一覧を作り直すときに再取得するページ数の上限。
 * 削除すると以降のページのオフセットがずれて行が飛ぶため、
 * 読み込み済みページを取り直して整合させる(暴走防止に上限を設ける)。
 */
const RELOAD_MAX_PAGES = 20;

export interface InfiniteCol {
  header: string;
  /** 指定すると昇順/降順ソート可能なヘッダーになる(DBカラム名) */
  sortField?: string;
  headClassName?: string;
}

/**
 * 行の選択と削除を有効にする設定。
 * 未指定(undefined)のときは選択列を描画せず、従来どおりの表示になる。
 * 呼び出し側は admin のときだけ渡すこと(RPC 側でも admin チェックあり)。
 */
export interface InfiniteSelection<T> {
  /** 行の主キーを返す */
  getId: (row: T) => string;
  /** 選択された行を論理削除する(Server Action を呼ぶ) */
  onDelete: (ids: string[]) => Promise<{ deleted?: number; error?: string }>;
  /** 確認ダイアログに出すオブジェクト名(例:「会員」) */
  objectLabel: string;
  /** 1件削除時に確認ダイアログへ出す対象名(氏名など)。省略時は ID を表示。 */
  getLabel?: (row: T) => string;
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
  selection,
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
  /** 行の選択・削除を有効にする(admin のみ)。省略時は選択列を出さない。 */
  selection?: InfiniteSelection<T>;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<T[]>(initialRows);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(initialRows.length >= total);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // --- 行の選択・削除 ---
  // 選択中の行ID。無限スクロールで行が増えても選択は維持する。
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // 削除確認ダイアログ。単体削除も一括削除も同じダイアログを使う(対象IDの数が違うだけ)。
  const [pendingIds, setPendingIds] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // 削除した件数。表示中の総件数から差し引く(サーバー側の total はリフレッシュまで古いため)。
  const [removedCount, setRemovedCount] = useState(0);
  // 一覧自体をスクロール領域にし、その中で sticky ヘッダーと無限スクロール監視を行う
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;

  // --- 列幅ドラッグ調整 ---
  // 列キー(ラベル/フィールド名)で識別。storageKey は列構成で一意(オブジェクトごとに別).
  const dataColKeys = columns.map((c, i) => c.sortField ?? c.header ?? String(i));
  // 選択列は先頭に固定幅で挿入する(colgroup と thead の並びを一致させるため colKeys にも含める)。
  const colKeys = selection ? [SELECT_COL_KEY, ...dataColKeys] : dataColKeys;
  const { widths, allSeeded, onResizeStart, seedMissing } = useColumnResize(
    // storageKey は従来どおりデータ列だけで作る(選択列の有無で保存済み列幅が失われないように)。
    `crm.colw.list:${dataColKeys.join('|')}`,
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

  // 削除ぶんを差し引いた表示用の総件数(サーバー側 total は router.refresh() まで古い)
  const displayTotal = Math.max(0, total - removedCount);
  const selectedCount = selectedIds.size;
  const allOnScreenSelected =
    selection != null && rows.length > 0 && rows.every((r) => selectedIds.has(selection.getId(r)));

  /** ヘッダーのチェック: 画面に読み込み済みの行だけを全選択/全解除する */
  const toggleAllOnScreen = () => {
    if (!selection) return;
    setSelectedIds(allOnScreenSelected ? new Set() : new Set(rows.map((r) => selection.getId(r))));
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /**
   * 削除後に読み込み済みページを取り直す。
   * 削除すると以降のページのオフセットがずれ、取り直さないと行が飛ぶため。
   * RELOAD_MAX_PAGES を超えて読み込んでいた場合は上限までに切り詰める
   * (件数は減るが、続きは下スクロールで正しく読み込める)。
   */
  const reloadLoadedPages = async (deletedIds: Set<string>, deleted: number) => {
    if (!selection) return;
    const target = Math.min(page, RELOAD_MAX_PAGES);
    setLoading(true);
    try {
      const acc: T[] = [];
      let lastChunk = 0;
      for (let p = 1; p <= target; p++) {
        const chunk = await loadMoreRef.current(p);
        acc.push(...chunk);
        lastChunk = chunk.length;
        if (chunk.length < pageSize) break;
      }
      setRows(acc);
      setPage(target);
      setDone(lastChunk < pageSize || acc.length >= Math.max(0, total - removedCount - deleted));
    } catch {
      // 取り直しに失敗したときは、少なくとも削除した行は消しておく
      setRows((prev) => prev.filter((r) => !deletedIds.has(selection.getId(r))));
    } finally {
      setLoading(false);
    }
  };

  const confirmDelete = async () => {
    if (!selection || !pendingIds) return;
    setDeleting(true);
    setDeleteError(null);
    const res = await selection.onDelete(pendingIds);
    if (res.error) {
      setDeleteError(res.error);
      setDeleting(false);
      return;
    }
    const deleted = res.deleted ?? pendingIds.length;
    const deletedIds = new Set(pendingIds);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of deletedIds) next.delete(id);
      return next;
    });
    setRemovedCount((c) => c + deleted);
    setPendingIds(null);
    setDeleting(false);
    await reloadLoadedPages(deletedIds, deleted);
    // サーバー側の総件数・他画面の表示を更新
    router.refresh();
  };

  /** 削除確認ダイアログに出す対象名(1件のときのみ) */
  const pendingLabel =
    selection && pendingIds?.length === 1
      ? (() => {
          const row = rows.find((r) => selection.getId(r) === pendingIds[0]);
          if (!row) return pendingIds[0];
          return selection.getLabel?.(row) ?? selection.getId(row);
        })()
      : undefined;

  return (
    // fillParent 時は親(flex-col・固定高さ)いっぱいを占め、内側でスクロールさせる
    <div className={cn(fillParent && 'flex min-h-0 flex-1 flex-col')}>
      {/* 選択中バー: 1件以上チェックされているときだけ出す(一括削除の入口) */}
      {selection && selectedCount > 0 && (
        <div className="mb-2 flex items-center gap-3 rounded border border-destructive/30 bg-destructive/5 px-3 py-2">
          <span className="text-sm font-medium">{selectedCount.toLocaleString()} 件を選択中</span>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-muted-foreground underline hover:text-foreground"
          >
            選択を解除
          </button>
          <button
            type="button"
            onClick={() => {
              setDeleteError(null);
              setPendingIds(Array.from(selectedIds));
            }}
            className="ml-auto inline-flex items-center gap-1 rounded bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90"
          >
            <Trash2 className="h-3.5 w-3.5" />
            選択した{selection.objectLabel}を削除
          </button>
        </div>
      )}
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
            // fixed レイアウト時は本文セルをはみ出さず省略表示(…)にする。
            // ヘッダー(th)には overflow-hidden を付けない(sticky ヘッダーが無効化されるため)。
            fixed && '[&_td]:overflow-hidden [&_td]:text-ellipsis',
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
              {/* 選択列: 読み込み済みの行をまとめてチェックする(リサイズ対象外) */}
              {selection && (
                <TableHead
                  key={SELECT_COL_KEY}
                  className="sticky top-0 z-20 h-9 w-[72px] bg-gray-50 px-2"
                >
                  <input
                    type="checkbox"
                    aria-label="表示中の行をすべて選択"
                    checked={allOnScreenSelected}
                    onChange={toggleAllOnScreen}
                    disabled={rows.length === 0}
                    className="h-4 w-4 cursor-pointer accent-primary align-middle"
                  />
                </TableHead>
              )}
              {columns.map((c, i) => {
                // colKeys は選択列を先頭に含むため、データ列は 1 つずらして参照する
                const k = colKeys[selection ? i + 1 : i] ?? String(i);
                return (
                  <TableHead
                    key={c.header}
                    // sticky 自体が absolute な子(リサイズハンドル)の基準になるため relative は付けない
                    // (relative を付けると position が競合して sticky が無効化される)
                    className={cn(
                      'sticky top-0 z-20 bg-gray-50',
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
                  colSpan={columns.length + (selection ? 1 : 0)}
                  className="py-6 text-center text-sm text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r, i) => {
                const rowId = selection?.getId(r);
                return (
                  <TableRow
                    key={getKey(r, i)}
                    className={`sf-row-hover ${rowClassName?.(r, i) ?? ''}`}
                  >
                    {/* 左端: チェックボックス + 削除ボタン */}
                    {selection && rowId !== undefined && (
                      <TableCell className="w-[72px] whitespace-nowrap px-2 py-2">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            aria-label="この行を選択"
                            checked={selectedIds.has(rowId)}
                            onChange={() => toggleOne(rowId)}
                            className="h-4 w-4 cursor-pointer accent-primary"
                          />
                          <button
                            type="button"
                            aria-label={`この${selection.objectLabel}を削除`}
                            title="削除"
                            onClick={() => {
                              setDeleteError(null);
                              setPendingIds([rowId]);
                            }}
                            className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </TableCell>
                    )}
                    {renderRow(r)}
                  </TableRow>
                );
              })
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
              ? `全 ${displayTotal.toLocaleString()} 件を表示`
              : `${rows.length.toLocaleString()} / ${displayTotal.toLocaleString()} 件`}
        </div>
      )}

      {selection && (
        <DeleteConfirmDialog
          open={pendingIds !== null}
          onOpenChange={(o) => {
            if (!o && !deleting) setPendingIds(null);
          }}
          count={pendingIds?.length ?? 0}
          objectLabel={selection.objectLabel}
          targetLabel={pendingLabel}
          pending={deleting}
          error={deleteError}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}
