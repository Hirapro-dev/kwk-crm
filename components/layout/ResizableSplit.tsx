'use client';

/**
 * 左右2ペインを、間の仕切り(ドラッグ)で横幅調整できる分割レイアウト。
 *
 * - 左ペイン幅を「コンテナ幅に対する％」で管理し、min/max でクランプ。
 * - 幅は localStorage に保存して次回も復元する(storageKey ごと)。
 * - 左右の中身はサーバーコンポーネントでも渡せる(props として受け取り描画するだけ)。
 *
 * 使い方:
 *   <ResizableSplit className="h-[...]" left={<左>} right={<右>} />
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** 左ペイン幅(%)を下限/上限でクランプ */
function clampPct(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

interface Props {
  left: React.ReactNode;
  right: React.ReactNode;
  /** 幅を記憶するキー(画面ごとに変える) */
  storageKey?: string;
  /** 初期の左ペイン幅(%) */
  defaultLeftPct?: number;
  /** 左ペイン幅の下限(%) */
  minPct?: number;
  /** 左ペイン幅の上限(%) */
  maxPct?: number;
  className?: string;
}

export function ResizableSplit({
  left,
  right,
  storageKey = 'split-left-pct',
  defaultLeftPct = 38,
  minPct = 22,
  maxPct = 72,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const [leftPct, setLeftPct] = useState(defaultLeftPct);

  // 初期復元
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved != null) {
        const n = Number(saved);
        if (Number.isFinite(n)) setLeftPct(clampPct(n, minPct, maxPct));
      }
    } catch {
      /* localStorage 不可の環境では既定値のまま */
    }
  }, [storageKey, minPct, maxPct]);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setLeftPct(clampPct(pct, minPct, maxPct));
    },
    [minPct, maxPct],
  );

  const stop = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    setLeftPct((p) => {
      try {
        window.localStorage.setItem(storageKey, String(Math.round(p * 10) / 10));
      } catch {
        /* 保存失敗は無視 */
      }
      return p;
    });
  }, [storageKey]);

  useEffect(() => {
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, [onPointerMove, stop]);

  const startDrag = () => {
    draggingRef.current = true;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  };

  return (
    <div ref={containerRef} className={`flex ${className ?? ''}`}>
      {/* 左ペイン */}
      <div style={{ width: `${leftPct}%` }} className="min-w-0 shrink-0">
        {left}
      </div>

      {/* 仕切り(ドラッグ) */}
      <button
        type="button"
        aria-label="ペイン幅を調整"
        onPointerDown={startDrag}
        style={{ touchAction: 'none' }}
        className="group relative mx-1 flex w-2 shrink-0 cursor-col-resize items-center justify-center"
      >
        <span className="h-full w-px bg-border transition-colors group-hover:bg-primary" />
        {/* つまみ(グリップ) */}
        <span className="absolute h-8 w-1 rounded bg-border transition-colors group-hover:bg-primary" />
      </button>

      {/* 右ペイン */}
      <div className="min-w-0 flex-1">{right}</div>
    </div>
  );
}
