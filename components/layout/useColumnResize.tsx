'use client';

/**
 * テーブルの列幅をドラッグで調整するための共通フック。
 *
 * - 列ごとの幅(px)を state で保持し、localStorage(storageKey)に保存/復元する。
 * - 初期幅は各テーブルが「現在の自動幅を計測して seedMissing で流し込む」ことで、
 *   見た目を変えずに調整可能にする(未保存の列のみ計測値を採用)。
 * - table-layout:fixed + <colgroup> と併用する前提。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface ColumnResize {
  widths: Record<string, number>;
  /** すべての列に幅が入っている(=fixed レイアウトに切り替えてよい)か */
  allSeeded: (keys: string[]) => boolean;
  /** ヘッダー右端ハンドルの onPointerDown から呼ぶ */
  onResizeStart: (key: string, startWidth: number, e: React.PointerEvent) => void;
  /** 未設定の列だけ計測値で埋める(初期表示の見た目維持) */
  seedMissing: (measurements: Record<string, number>) => void;
}

const MIN_WIDTH = 60;

export function useColumnResize(storageKey: string): ColumnResize {
  const [widths, setWidths] = useState<Record<string, number>>({});
  const dragRef = useRef<{ key: string; startX: number; startW: number } | null>(null);

  // 保存済み幅の復元(storageKey ごと)
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      const o = raw ? JSON.parse(raw) : null;
      setWidths(o && typeof o === 'object' ? (o as Record<string, number>) : {});
    } catch {
      setWidths({});
    }
  }, [storageKey]);

  // ドラッグ中の pointermove / pointerup
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const w = Math.max(MIN_WIDTH, Math.round(d.startW + (e.clientX - d.startX)));
      setWidths((p) => ({ ...p, [d.key]: w }));
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      setWidths((p) => {
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(p));
        } catch {
          /* 保存失敗は無視 */
        }
        return p;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [storageKey]);

  const onResizeStart = useCallback((key: string, startWidth: number, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { key, startX: e.clientX, startW: startWidth };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  }, []);

  const seedMissing = useCallback((m: Record<string, number>) => {
    setWidths((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [k, v] of Object.entries(m)) {
        if (next[k] == null && v > 0) {
          next[k] = Math.round(v);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const allSeeded = useCallback(
    (keys: string[]) => keys.length > 0 && keys.every((k) => widths[k] != null),
    [widths],
  );

  return { widths, allSeeded, onResizeStart, seedMissing };
}

/**
 * ヘッダーセル右端に置くリサイズ用ハンドル。
 * th 側に `relative` を付けること。ドラッグ開始時に親 th の現在幅を起点にする。
 */
export function ColumnResizeHandle({
  onStart,
}: {
  onStart: (startWidth: number, e: React.PointerEvent) => void;
}) {
  return (
    <span
      aria-hidden="true"
      title="ドラッグで列幅を調整"
      onPointerDown={(e) => {
        const th = (e.currentTarget as HTMLElement).closest('th');
        onStart(th ? th.offsetWidth : 120, e);
      }}
      onClick={(e) => e.stopPropagation()}
      style={{ touchAction: 'none' }}
      className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize select-none bg-transparent hover:bg-primary/40"
    />
  );
}
