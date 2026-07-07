'use client';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils/cn';
import { DATE_PRESET_LABELS, type DatePresetKey, normalizePreset } from '@/lib/utils/date_preset';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';

interface Props {
  preset: DatePresetKey;
  from: string;
  to: string;
}

const PRESET_BUTTONS: DatePresetKey[] = [
  'today',
  'yesterday',
  'this_month',
  'last_month',
  'last_3_months',
  'last_6_months',
  'last_12_months',
  'all',
  'custom',
];

/** 対応歴サマリの期間フィルタ(期間のみ)。URL クエリ(tab=activities 維持)で状態管理。 */
export function ActivitySummaryFilterBar({ preset, from, to }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();

  const updateQuery = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(sp?.toString() ?? '');
      next.set('tab', 'activities');
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === '') next.delete(k);
        else next.set(k, v);
      }
      startTransition(() => {
        router.push(`/summary?${next.toString()}`);
      });
    },
    [router, sp],
  );

  const onPresetClick = (p: DatePresetKey) => {
    const safe = normalizePreset(p);
    if (safe !== 'custom') updateQuery({ apreset: safe, afrom: null, ato: null });
    else updateQuery({ apreset: safe });
  };

  return (
    <div className="space-y-2 rounded border bg-card p-3 shadow-sm">
      <div className="flex items-center gap-2 overflow-x-auto">
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          期間
        </span>
        {PRESET_BUTTONS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPresetClick(p)}
            className={cn(
              'shrink-0 whitespace-nowrap rounded border px-3 py-1 text-xs transition-colors',
              preset === p
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input bg-card text-foreground hover:bg-accent',
            )}
          >
            {DATE_PRESET_LABELS[p]}
          </button>
        ))}
      </div>

      {preset === 'custom' && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            期間指定
          </span>
          <Input
            type="date"
            value={from}
            onChange={(e) => updateQuery({ apreset: 'custom', afrom: e.target.value })}
            className="w-40"
            aria-label="開始日"
          />
          <span className="text-xs text-muted-foreground">〜</span>
          <Input
            type="date"
            value={to}
            onChange={(e) => updateQuery({ apreset: 'custom', ato: e.target.value })}
            className="w-40"
            aria-label="終了日"
          />
        </div>
      )}
    </div>
  );
}
