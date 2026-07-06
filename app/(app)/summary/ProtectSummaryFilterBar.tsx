'use client';

import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils/cn';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';

interface Props {
  /** 現在の有効/無効フィルタ */
  initialActive: 'all' | 'active' | 'inactive';
  /** 現在のロールフィルタ('all' or ロール名) */
  initialRole: string;
}

/** ロール選択肢(migration 28 時点。'all'=全ロール) */
const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: '全ロール' },
  { value: 'admin', label: 'admin' },
  { value: 'manager', label: 'manager' },
  { value: 'sales', label: 'sales' },
  { value: 'support', label: 'support' },
  { value: 'viewer', label: 'viewer' },
];

/**
 * プロテクトサマリのフィルタバー。
 * プロテクト保持者(担当者)の有効/無効・ロールで表示を切り替える。
 *   - 有効/無効: すべて / 有効 / 無効
 *   - ロール: 全ロール / admin / manager / sales / support / viewer
 *
 * デフォルトは「有効 / sales」。URL クエリ `pactive` / `prole` で状態管理
 * (デフォルト値のときはパラメータを省略してURLを簡潔に保つ)。
 */
export function ProtectSummaryFilterBar({ initialActive, initialRole }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();

  const updateQuery = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(sp?.toString() ?? '');
      next.set('tab', 'protect');
      for (const [k, v] of Object.entries(patch)) {
        if (v == null) next.delete(k);
        else next.set(k, v);
      }
      startTransition(() => {
        router.push(`/summary?${next.toString()}`);
      });
    },
    [router, sp],
  );

  // デフォルト値(active/sales)のときはパラメータを消す。それ以外は明示的にセットする。
  const onActiveChange = (v: 'all' | 'active' | 'inactive') =>
    updateQuery({ pactive: v === 'active' ? null : v });
  const onRoleChange = (v: string) => updateQuery({ prole: v === 'sales' ? null : v });

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

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          ロール
        </span>
        <Select
          value={initialRole}
          onChange={(e) => onRoleChange(e.target.value)}
          className="w-48"
          aria-label="ロール"
        >
          {ROLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
