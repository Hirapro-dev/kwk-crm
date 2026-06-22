'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils/cn';
import {
  DATE_PRESET_LABELS,
  type DatePresetKey,
  normalizePreset,
} from '@/lib/utils/date_preset';

interface ProjectOption {
  id: number;
  name: string;
}

interface Props {
  projects: ProjectOption[];
  initialPreset: DatePresetKey;
  initialFrom: string;
  initialTo: string;
  initialProject: string;
}

const PRESET_BUTTONS: DatePresetKey[] = [
  'all',
  'today',
  'this_month',
  'last_month',
  'this_year',
  'last_year',
  'custom',
];

/**
 * サマリ画面の期間 + 案件フィルター。
 *
 * - URL クエリで状態管理 (preset, from, to, project)
 * - プリセットボタン群: 累計/今日/今月/先月/今年/昨年/期間指定
 * - 期間指定選択時のみ from-to の date input を表示
 * - 案件: applications.project_id で絞り込み
 */
export function SummaryFilterBar({
  projects,
  initialPreset,
  initialFrom,
  initialTo,
  initialProject,
}: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();

  const updateQuery = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(sp?.toString() ?? '');
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

  const onPresetClick = (preset: DatePresetKey) => {
    const safe = normalizePreset(preset);
    if (safe !== 'custom') {
      updateQuery({ preset: safe, from: null, to: null });
    } else {
      updateQuery({ preset: safe });
    }
  };

  const onFromChange = (v: string) => updateQuery({ preset: 'custom', from: v });
  const onToChange = (v: string) => updateQuery({ preset: 'custom', to: v });
  const onProjectChange = (v: string) =>
    updateQuery({ project: v === 'all' ? null : v });

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
              initialPreset === p
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input bg-card text-foreground hover:bg-accent',
            )}
          >
            {DATE_PRESET_LABELS[p]}
          </button>
        ))}
      </div>

      {initialPreset === 'custom' && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            期間指定
          </span>
          <Input
            type="date"
            value={initialFrom}
            onChange={(e) => onFromChange(e.target.value)}
            className="w-40"
            aria-label="開始日"
          />
          <span className="text-xs text-muted-foreground">〜</span>
          <Input
            type="date"
            value={initialTo}
            onChange={(e) => onToChange(e.target.value)}
            className="w-40"
            aria-label="終了日"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          案件
        </span>
        <Select
          value={initialProject}
          onChange={(e) => onProjectChange(e.target.value)}
          className="w-64"
          aria-label="案件"
        >
          <option value="all">全案件</option>
          {projects.map((p) => (
            <option key={p.id} value={String(p.id)}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
