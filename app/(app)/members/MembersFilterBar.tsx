'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

/**
 * 会員一覧用フィルタバー(仕様書 §8.1)。
 * - q: 名前/カナ/メール/電話/ID あいまい検索
 * - owner: 'me' / 'free' / 'all'(担当)
 */
export function MembersFilterBar({
  initialQ,
  initialOwner,
  currentUserId,
}: {
  initialQ: string;
  initialOwner: string;
  currentUserId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [q, setQ] = useState(initialQ);
  const [owner, setOwner] = useState(initialOwner);

  const submit = (nextQ: string, nextOwner: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (nextQ) params.set('q', nextQ);
    else params.delete('q');
    if (nextOwner && nextOwner !== 'all') params.set('owner', nextOwner);
    else params.delete('owner');
    params.delete('page');
    const qs = params.toString();
    startTransition(() => router.push(qs ? `/members?${qs}` : '/members'));
  };

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit(q, owner);
      }}
    >
      <div className="flex-1 min-w-[200px]">
        <Input
          placeholder="氏名・カナ・メール・電話・会員IDで検索"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <Select
        className="w-44"
        value={owner === 'me' ? currentUserId : owner}
        onChange={(e) => {
          const v = e.target.value;
          setOwner(v === currentUserId ? 'me' : v);
        }}
      >
        <option value="all">担当: すべて</option>
        <option value={currentUserId}>自分の担当</option>
        <option value="free">Free(担当なし)</option>
      </Select>
      <Button type="submit" disabled={pending}>
        {pending ? '検索中…' : '検索'}
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setQ('');
          setOwner('all');
          submit('', 'all');
        }}
      >
        クリア
      </Button>
    </form>
  );
}
