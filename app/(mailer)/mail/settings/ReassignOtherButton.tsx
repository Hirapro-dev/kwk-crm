'use client';

import { Button } from '@/components/ui/button';
import { reassignOtherMailThreadsRange } from '@/lib/domain/mail_box_actions';
import { reassignRanges } from '@/lib/domain/mail_box_settings';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * 「その他」フォルダの再振り分けを手動で実行するボタン(受信箱を追加したときは、その受信箱の分だけ自動でも実行される)。
 * 主な用途: アドレスの表記ゆれを直した後や、複数アドレスをまとめて登録した直後の再実行。
 * 全件を 1 回で走査すると DB の 8 秒制限で止まるため、期間(年)ごとに順に Server Action を呼び、進捗を出す。
 */
export function ReassignOtherButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const ranges = reassignRanges(new Date().getFullYear());
      let total = 0;
      for (const [i, range] of ranges.entries()) {
        setProgress(`${range.label} を確認中… (${i + 1}/${ranges.length})`);
        const r = await reassignOtherMailThreadsRange({ from: range.from, to: range.to });
        if (r.error) {
          setProgress(null);
          setError(`${range.label}: ${r.error}(ここまでの移動 ${total} 件)`);
          return;
        }
        total += r.moved ?? 0;
      }
      setProgress(null);
      setResult(
        total > 0 ? `${total} 件のスレッドを移動しました` : '移動できるメールはありませんでした',
      );
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={onClick} disabled={pending}>
        {pending ? '実行中…' : '再振り分けを実行'}
      </Button>
      {progress && <span className="text-xs text-muted-foreground">{progress}</span>}
      {result && <span className="text-xs text-emerald-700">{result}</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
