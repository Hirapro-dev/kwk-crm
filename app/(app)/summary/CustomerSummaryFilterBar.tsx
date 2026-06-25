'use client';

import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils/cn';
import { GRANULARITY_LABELS, type Granularity } from '@/lib/utils/date_bucket';
import { DATE_PRESET_LABELS, type DatePresetKey, normalizePreset } from '@/lib/utils/date_preset';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';
import { PointMultiSelect } from './PointMultiSelect';

export type CustomerAxis = 'point' | 'member';

interface Props {
  preset: DatePresetKey;
  from: string;
  to: string;
  granularity: Granularity;
  phoneAcquired: boolean;
  emailOnly: boolean;
  unpaid: boolean;
  /** 個人情報取得ポイント候補 */
  pointOptions: string[];
  /** 選択中の取得ポイント */
  selectedPoints: string[];
  /** 一覧の表示軸 */
  axis: CustomerAxis;
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

/** 新規顧客取得サマリの期間/粒度/フィルタ。URL クエリ(tab=customers を維持)で状態管理。 */
export function CustomerSummaryFilterBar({
  preset,
  from,
  to,
  granularity,
  phoneAcquired,
  emailOnly,
  unpaid,
  pointOptions,
  selectedPoints,
  axis,
}: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();

  const updateQuery = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(sp?.toString() ?? '');
      next.set('tab', 'customers');
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
    if (safe !== 'custom') updateQuery({ cpreset: safe, cfrom: null, cto: null });
    else updateQuery({ cpreset: safe });
  };

  const toggle = (key: string, current: boolean) => updateQuery({ [key]: current ? null : '1' });

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
            onChange={(e) => updateQuery({ cpreset: 'custom', cfrom: e.target.value })}
            className="w-40"
            aria-label="開始日"
          />
          <span className="text-xs text-muted-foreground">〜</span>
          <Input
            type="date"
            value={to}
            onChange={(e) => updateQuery({ cpreset: 'custom', cto: e.target.value })}
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
          onChange={(e) => updateQuery({ gran: e.target.value })}
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

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          条件
        </span>
        {(
          [
            { key: 'fp', label: '電話番号取得済み', val: phoneAcquired },
            { key: 'fe', label: 'メアドのみ取得', val: emailOnly },
            { key: 'fu', label: '未入金', val: unpaid },
          ] as const
        ).map(({ key, label, val }) => (
          <label key={key} className="flex cursor-pointer items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={val}
              onChange={() => toggle(key, val)}
              className="h-4 w-4"
            />
            {label}
          </label>
        ))}
      </div>

      {/* 個人情報取得ポイント(複数選択) */}
      <div className="flex flex-wrap items-start gap-2">
        <span className="mt-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          取得ポイント
        </span>
        <PointMultiSelect
          options={pointOptions}
          selected={selectedPoints}
          onChange={(next) => updateQuery({ pts: next.length ? next.join(',') : null })}
        />
      </div>

      {/* 一覧の表示軸 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          一覧の軸
        </span>
        {(
          [
            { key: 'point', label: '個人情報取得ポイント軸' },
            { key: 'member', label: '会員氏名軸' },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => updateQuery({ axis: key === 'point' ? null : key })}
            className={cn(
              'rounded border px-3 py-1 text-xs transition-colors',
              axis === key
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
