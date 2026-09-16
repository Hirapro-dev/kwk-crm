'use client';

import type { InfiniteSelectionContext } from '@/components/layout/InfiniteTable';
import { bulkUpdateMailThreads } from '@/lib/domain/mail_actions';
import {
  MAIL_CATEGORIES,
  MAIL_STATUSES,
  type MailCategory,
  type MailStatus,
} from '@/lib/domain/mail_types';
import { useState, useTransition } from 'react';

/**
 * メーラー一覧の一括操作(CLAUDE.md §5.15 / §8.1)。チェックした行に対して
 * 状態 / 分類 / 担当 / 既読・未読 をまとめて変更する。選択中バー(InfiniteTable)に描画される。
 * 実行は Server Action bulkUpdateMailThreads(viewer 不可、1回 500 件まで)。
 */
interface Props {
  ctx: InfiniteSelectionContext;
  assigneeOptions: Array<{ id: string; name: string }>;
}

const selectClass =
  'h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring';
const buttonClass =
  'h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-accent disabled:opacity-50';

export function MailBulkActions({ ctx, assigneeOptions }: Props) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const run = (patch: Omit<Parameters<typeof bulkUpdateMailThreads>[0], 'ids'>, label: string) => {
    setMessage(null);
    startTransition(async () => {
      const r = await bulkUpdateMailThreads({ ids: ctx.ids, ...patch });
      if (r.error) {
        setMessage(r.error);
        return;
      }
      setMessage(`${r.updated ?? 0} 件を${label}にしました`);
      await ctx.refresh();
      ctx.clear();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <label className="flex items-center gap-1">
        状態
        <select
          className={selectClass}
          value=""
          disabled={pending}
          onChange={(e) => {
            const v = e.target.value as MailStatus;
            if (v) run({ status: v }, `「${v}」`);
          }}
          aria-label="選択したメールの状態を変更"
        >
          <option value="">変更…</option>
          {MAIL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1">
        分類
        <select
          className={selectClass}
          value=""
          disabled={pending}
          onChange={(e) => {
            const v = e.target.value as MailCategory;
            if (v) run({ category: v }, `「${v}」`);
          }}
          aria-label="選択したメールの分類を変更"
        >
          <option value="">変更…</option>
          {MAIL_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1">
        担当
        <select
          className={selectClass}
          value=""
          disabled={pending}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '__none') run({ assigneeId: null }, '担当なし');
            else if (v) {
              const name = assigneeOptions.find((a) => a.id === v)?.name ?? v;
              run({ assigneeId: v }, `担当「${name}」`);
            }
          }}
          aria-label="選択したメールの担当を変更"
        >
          <option value="">変更…</option>
          <option value="__none">(担当を外す)</option>
          {assigneeOptions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className={buttonClass}
        disabled={pending}
        onClick={() => run({ isRead: true }, '既読')}
      >
        既読にする
      </button>
      <button
        type="button"
        className={buttonClass}
        disabled={pending}
        onClick={() => run({ isRead: false }, '未読')}
      >
        未読にする
      </button>
      {pending && <span className="text-muted-foreground">更新中…</span>}
      {message && !pending && (
        <span
          className={
            message.includes('失敗') || message.includes('できません')
              ? 'text-destructive'
              : 'text-emerald-700'
          }
        >
          {message}
        </span>
      )}
    </div>
  );
}
