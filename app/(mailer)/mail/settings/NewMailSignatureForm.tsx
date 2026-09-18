'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { createMailSignature } from '@/lib/domain/mail_signature_actions';
import { MAX_SIGNATURE_NAME_CHARS } from '@/lib/domain/mail_signatures';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/** 署名の追加フォーム(署名マスタ。CLAUDE.md §5.15「署名」)。受信箱の NewMailBoxForm と同じ方式 */
export function NewMailSignatureForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    setDone(null);
    startTransition(async () => {
      const r = await createMailSignature({ name, body });
      if (r.error) {
        setError(r.error);
        return;
      }
      setDone(`署名「${name.trim()}」を追加しました`);
      setName('');
      setBody('');
      router.refresh();
    });
  };

  return (
    <form
      className="space-y-2 border-b px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="block min-w-56 flex-1 text-xs">
          署名名
          <Input
            aria-label="署名名"
            className="mt-1"
            placeholder="例: 営業部 共通"
            maxLength={MAX_SIGNATURE_NAME_CHARS}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={pending}
            required
          />
        </div>
        <Button type="submit" size="sm" disabled={pending || !name.trim() || !body.trim()}>
          {pending ? '追加中…' : '署名を追加'}
        </Button>
        {done && <span className="text-xs text-emerald-700">{done}</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
      <div className="block text-xs">
        本文
        <Textarea
          aria-label="署名の本文"
          className="mt-1"
          rows={4}
          placeholder={'例:\n株式会社〇〇 サポート\nTEL 00-0000-0000'}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={pending}
        />
      </div>
    </form>
  );
}
