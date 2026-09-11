'use client';

import { Button } from '@/components/ui/button';
import { reassignOtherMailThreads } from '@/lib/domain/mail_box_actions';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * 「その他」フォルダの再振り分けを手動で実行するボタン(受信箱を追加したときは自動でも実行される)。
 * 主な用途: アドレスの表記ゆれを直した後や、複数アドレスをまとめて登録した直後の再実行。
 */
export function ReassignOtherButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const r = await reassignOtherMailThreads();
      if (r.error) {
        setError(r.error);
        return;
      }
      setResult(
        r.moved && r.moved > 0
          ? `${r.moved} 件のスレッドを移動しました`
          : '移動できるメールはありませんでした',
      );
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={onClick} disabled={pending}>
        {pending ? '実行中…' : '再振り分けを実行'}
      </Button>
      {result && <span className="text-xs text-emerald-700">{result}</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
