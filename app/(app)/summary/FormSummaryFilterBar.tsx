'use client';

import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils/cn';
import { GRANULARITY_LABELS, type Granularity } from '@/lib/utils/date_bucket';
import { DATE_PRESET_LABELS, type DatePresetKey, normalizePreset } from '@/lib/utils/date_preset';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';
import { FormMultiSelect, type FormOption } from './FormMultiSelect';

export type FormMode = 'record' | 'unique';

interface Props {
  preset: DatePresetKey;
  from: string;
  to: string;
  granularity: Granularity;
  formOptions: FormOption[];
  selectedForms: number[];
  mode: FormMode;
}

const PRESET_BUTTONS: DatePresetKey[] = [
  'this_month',
  'last_month',
  'last_3_months',
  'last_6_months',
  'last_12_months',
  'all',
  'custom',
];

const GRANULARITIES: Granularity[] = ['day', 'week', 'month', 'quarter', 'half', 'year'];

/** フォーム集計サマリの期間/粒度/フォーム選択/集計モード。URL クエリ(tab=forms 維持)で状態管理。 */
export function FormSummaryFilterBar({
  preset,
  from,
  to,
  granularity,
  formOptions,
  selectedForms,
  mode,
}: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();

  const updateQuery = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(sp?.toString() ?? '');
      next.set('tab', 'forms');
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
    if (safe !== 'custom') updateQuery({ fpreset: safe, ffrom: null, fto: null });
    else updateQuery({ fpreset: safe });
  };

  return (
    <div className="space-y-2 rounded border bg-card p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          期間
        </span>
        {PRESET_BUTTONS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPresetClick(p)}
            className={cn(
              'rounded border px-3 py-1 text-xs transition-colors',
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
            onChange={(e) => updateQuery({ fpreset: 'custom', ffrom: e.target.value })}
            className="w-40"
            aria-label="開始日"
          />
          <span className="text-xs text-muted-foreground">〜</span>
          <Input
            type="date"
            value={to}
            onChange={(e) => updateQuery({ fpreset: 'custom', fto: e.target.value })}
            className="w-40"
            aria-label="終了日"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          表示
        </span>
        <Select
          value={granularity}
          onChange={(e) => updateQuery({ fgran: e.target.value })}
          className="w-32"
          aria-label="表示粒度"
        >
          {GRANULARITIES.map((g) => (
            <option key={g} value={g}>
              {GRANULARITY_LABELS[g]}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-wrap items-start gap-2">
        <span className="mt-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          フォーム
        </span>
        <FormMultiSelect
          options={formOptions}
          selected={selectedForms}
          onChange={(next) => updateQuery({ forms: next.length ? next.join(',') : null })}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          集計
        </span>
        {(
          [
            { key: 'record', label: 'レコード件数' },
            { key: 'unique', label: 'ユニーク件数' },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => updateQuery({ fmode: key === 'record' ? null : key })}
            className={cn(
              'rounded border px-3 py-1 text-xs transition-colors',
              mode === key
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
