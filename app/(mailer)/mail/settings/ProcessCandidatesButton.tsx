'use client';

import { Button } from '@/components/ui/button';
import { processImportCandidates } from '@/lib/domain/mail_import_exec_actions';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * 取込候補の未処理メールをまとめて取り込む(§5.16 段階③)。1回で最大 300 件。
 * 残りがあれば続けて押す。過去分が多い場合は scripts/mail/process_import_candidates.ts で一括実行する。
 */
export function ProcessCandidatesButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  const run = () => {
    setResult(null);
    startTransition(async () => {
      const r = await processImportCandidates();
      if (r.error) {
        setResult(`エラー: ${r.error}`);
        return;
      }
      const s = r.summary;
      if (!s) return;
      const rest = s.truncated
        ? '。未処理が残っている可能性があります。もう一度押してください。'
        : '。未処理はありません。';
      setResult(
        `処理 ${s.processed} 件(作成・紐付け ${s.done} / ルール未一致 ${s.pending} / エラー ${s.error})${rest}`,
      );
      router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" size="sm" onClick={run} disabled={pending}>
        {pending ? '処理中…' : '候補を処理(未処理から最大300件)'}
      </Button>
      {result && <span className="text-xs text-muted-foreground">{result}</span>}
    </div>
  );
}
