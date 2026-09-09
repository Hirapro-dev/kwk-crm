'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { createMailBox } from '@/lib/domain/mail_box_actions';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/** 受信箱(共有アドレス)の追加フォーム。案件マスタの NewProjectForm と同じ方式 */
export function NewMailBoxForm() {
  const router = useRouter();
  const [address, setAddress] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    setDone(null);
    startTransition(async () => {
      const r = await createMailBox({ address, displayName });
      if (r.error) {
        setError(r.error);
        return;
      }
      setDone(`${address.trim().toLowerCase()} を追加しました`);
      setAddress('');
      setDisplayName('');
      router.refresh();
    });
  };

  return (
    <Card className="p-4 shadow-sm">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="block min-w-64 flex-1 text-xs">
          追加する共有アドレス
          <Input
            aria-label="共有アドレス"
            className="mt-1"
            placeholder="例: info@example.co.jp"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            disabled={pending}
            required
          />
        </div>
        <div className="block min-w-48 flex-1 text-xs">
          差出人表示名(任意)
          <Input
            aria-label="差出人表示名"
            className="mt-1"
            placeholder="例: ひらプロ"
            maxLength={80}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={pending}
          />
        </div>
        <Button type="submit" size="sm" disabled={pending || !address.trim()}>
          {pending ? '追加中…' : '受信箱を追加'}
        </Button>
        {done && <span className="text-xs text-emerald-700">{done}</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </form>
    </Card>
  );
}
