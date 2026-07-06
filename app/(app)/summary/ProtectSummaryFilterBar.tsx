'use client';

import { cn } from '@/lib/utils/cn';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';

interface Props {
  /** 現在の有効/無効フィルタ */
  initialActive: 'all' | 'active' | 'inactive';
}

/**
 * プロテクトサマリのフィルタバー。
 * プロテクト保持者(担当者)の有効/無効で表示を切り替える。
 *   - すべて / 有効 / 無効
 * URL クエリ `pactive` で状態管理(他タブと衝突しないプレフィックス)。
 */
export function ProtectSummaryFilterBar({ initialActive }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();

  const onActiveChange = useCallback(
    (v: 'all' | 'active' | 'inactive') => {
      const next = new URLSearchParams(sp?.toString() ?? '');
      next.set('tab', 'protect');
      if (v === 'all') next.delete('pactive');
      else next.set('pactive', v);
      startTransition(() => {
        router.push(`/summary?${next.toString()}`);
      });
    },
    [router, sp],
  );

  return (
    <div className="space-y-2 rounded border bg-card p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          プロテクト保持者
        </span>
        {(
          [
            { key: 'all', label: 'すべて' },
            { key: 'active', label: '有効' },
            { key: 'inactive', label: '無効' },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => onActiveChange(key)}
            className={cn(
              'rounded border px-3 py-1 text-xs transition-colors',
              initialActive === key
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input bg-card text-foreground hover:bg-accent',
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
