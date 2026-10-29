'use client';

import { Button } from '@/components/ui/button';
import { rebuildMailThreadCounts } from '@/lib/domain/mail_thread_count_actions';
import { useState, useTransition } from 'react';

/**
 * 「件数を数え直す」(admin)。タブ・左フォルダの件数表(migration 136)を実際の件数で数え直す。
 * 何度押しても結果は同じ。違っていた区分の数を出す(0 = 一致していた)。
 */
export function RebuildCountsButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const r = await rebuildMailThreadCounts();
      if (r.error) {
        setError(r.error);
        return;
      }
      setResult(
        r.changed
          ? `${r.changed} 区分の件数が実際と違っていたため、数え直しました`
          : '件数は実際と一致していました',
      );
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={onClick} disabled={pending}>
        {pending ? '数え直し中…' : '件数を数え直す'}
      </Button>
      {result && <span className="text-xs text-emerald-700">{result}</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
