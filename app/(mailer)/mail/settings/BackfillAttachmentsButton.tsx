'use client';

import { Button } from '@/components/ui/button';
import { backfillInboundAttachments } from '@/lib/domain/mail_attachment_backfill_actions';
import { useState, useTransition } from 'react';

/**
 * 「受信添付の取り直し」(admin)。日本語名の添付が保存されずに消えていた不具合(2026-10-23 修正)の分を、
 * S3 に残る元のメール(30 日分)から取り直す。何度押しても増えない。1 回の呼び出しで 100 通ずつ見て、進捗を出す。
 */
export function BackfillAttachmentsButton() {
  const [pending, startTransition] = useTransition();
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    setError(null);
    setResult(null);
    startTransition(async () => {
      let since: string | undefined;
      let offset = 0;
      let messages = 0;
      let restored = 0;
      let withMissing = 0;
      let failed = 0;
      for (;;) {
        setProgress(`${messages.toLocaleString()} 通を確認(取り直し ${restored} 件)…`);
        const r = await backfillInboundAttachments({ since, offset });
        if (r.error || !r.stats) {
          setProgress(null);
          setError(
            `${r.error ?? '失敗しました'}(ここまで ${messages} 通を確認、${restored} 件を取り直し)`,
          );
          return;
        }
        since = r.since;
        offset += r.stats.messages;
        messages += r.stats.messages;
        restored += r.stats.restored;
        withMissing += r.stats.withMissing;
        failed += r.stats.saveErrors + r.stats.readErrors;
        if (r.done || r.stats.messages === 0) break;
      }
      setProgress(null);
      const failNote = failed > 0 ? `(読み込み・保存に失敗 ${failed} 件)` : '';
      setResult(
        `${messages.toLocaleString()} 通を確認し、${withMissing} 通のメールの添付 ${restored} 件を取り直しました${failNote}`,
      );
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={onClick} disabled={pending}>
        {pending ? '実行中…' : '受信添付の取り直し'}
      </Button>
      {progress && <span className="text-xs text-muted-foreground">{progress}</span>}
      {result && <span className="text-xs text-emerald-700">{result}</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
