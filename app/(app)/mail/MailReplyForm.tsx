'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { replyToMailThread } from '@/lib/domain/mail_send_actions';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * スレッドへの返信フォーム(M2)。
 * 送信できない受信箱(SES でドメイン未検証)ではフォームを出さず理由だけ表示する。
 */
export function MailReplyForm({
  threadId,
  replyTo,
  sendable,
  disabledReason,
  signature,
}: {
  threadId: string;
  /** 返信先(表示用) */
  replyTo: string | null;
  sendable: boolean;
  disabledReason?: string;
  /** 送信時に自動で付く署名(表示用) */
  signature: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState('');
  const [cc, setCc] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (!sendable) {
    return (
      <div className="rounded border border-dashed p-3 text-xs text-muted-foreground">
        この受信箱は<strong>受信専用</strong>です。{disabledReason ?? ''}
      </div>
    );
  }

  const submit = () => {
    setError(null);
    setSent(false);
    startTransition(async () => {
      const r = await replyToMailThread({ threadId, body, cc });
      if (r.error) {
        setError(r.error);
        return;
      }
      setBody('');
      setCc('');
      setSent(true);
      router.refresh();
    });
  };

  return (
    <form
      className="space-y-2 rounded border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="text-xs text-muted-foreground">
        返信先: <span className="font-mono">{replyTo ?? '(不明)'}</span>
      </div>
      <Input
        aria-label="CC"
        placeholder="CC(カンマ区切り、任意)"
        value={cc}
        onChange={(e) => setCc(e.target.value)}
        disabled={pending}
      />
      <Textarea
        aria-label="本文"
        placeholder="返信本文"
        rows={8}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={pending}
      />
      {signature && (
        <details className="text-[11px] text-muted-foreground">
          <summary>署名(自動で末尾に付きます)</summary>
          <pre className="mt-1 whitespace-pre-wrap font-sans">{signature}</pre>
        </details>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending || !body.trim()}>
          {pending ? '送信中…' : '返信を送信'}
        </Button>
        {sent && <span className="text-xs text-emerald-700">送信しました</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </form>
  );
}
