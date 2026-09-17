'use client';

import {
  applyImportRuleToThreads,
  previewImportRuleMismatch,
} from '@/lib/domain/mail_import_exec_actions';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * 取込候補の一覧の「取込ルール」列で、どのルールにも一致しない(未設定)メールに既存ルールを手で当てはめる
 * (CLAUDE.md §5.16。2026-09-17)。ルールを選ぶと「なぜそのルールに一致しなかったか」を注釈で出し、
 * 「このルールで処理」で取り込む(注釈は処理結果にも残る)。admin のみ。
 */
interface Props {
  threadId: string;
  rules: Array<{ id: number; name: string }>;
}

const selectClass =
  'h-7 max-w-[170px] rounded-md border border-input bg-background px-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-ring';

export function ApplyImportRuleCell({ threadId, rules }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [ruleId, setRuleId] = useState<number | null>(null);
  const [reasons, setReasons] = useState<string[] | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const pick = (id: number | null) => {
    setRuleId(id);
    setReasons(null);
    setResult(null);
    if (id === null) return;
    startTransition(async () => {
      const r = await previewImportRuleMismatch(threadId, id);
      if (r.error) {
        setResult({ ok: false, text: r.error });
        return;
      }
      setReasons(r.reasons ?? []);
    });
  };

  const apply = () => {
    if (ruleId === null) return;
    startTransition(async () => {
      const r = await applyImportRuleToThreads({ threadIds: [threadId], ruleId });
      if (r.error) {
        setResult({ ok: false, text: r.error });
        return;
      }
      const note = r.notes?.[0] ?? '';
      setResult({ ok: (r.summary?.error ?? 0) === 0, text: note || '処理しました' });
      router.refresh();
    });
  };

  if (result) {
    return (
      <span
        className={`block truncate text-[11px] ${result.ok ? 'text-emerald-700' : 'text-destructive'}`}
        title={result.text}
      >
        {result.text}
      </span>
    );
  }

  return (
    <div
      className="space-y-1"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground">未設定</span>
        <select
          className={selectClass}
          value={ruleId ?? ''}
          disabled={pending}
          onChange={(e) => pick(e.target.value ? Number(e.target.value) : null)}
          aria-label="既存のルールを当てはめる"
        >
          <option value="">ルールを当てはめる…</option>
          {rules.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      {ruleId !== null && reasons && (
        <div className="rounded border border-amber-200 bg-amber-50 p-1 text-[11px] text-amber-800">
          {reasons.length === 0 ? (
            <div>
              このルールの条件には一致しています(判定順で他のルールが先に一致している可能性)
            </div>
          ) : (
            <ul className="list-disc pl-4">
              {reasons.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="mt-1 rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] hover:bg-amber-100 disabled:opacity-50"
            disabled={pending}
            onClick={apply}
          >
            {pending ? '処理中…' : 'このルールで処理'}
          </button>
        </div>
      )}
    </div>
  );
}
