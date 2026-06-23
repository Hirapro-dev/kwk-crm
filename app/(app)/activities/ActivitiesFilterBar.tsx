'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

export function ActivitiesFilterBar({
  initialMemberId,
  initialDBunrui,
  initialFrom,
  initialTo,
  bunruiList,
  currentUserId,
  initialOwner,
}: {
  initialMemberId: string;
  initialDBunrui: string;
  initialFrom: string;
  initialTo: string;
  bunruiList: string[];
  currentUserId: string;
  initialOwner: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [memberId, setMemberId] = useState(initialMemberId);
  const [dBunrui, setDBunrui] = useState(initialDBunrui);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [owner, setOwner] = useState(initialOwner);

  const submit = () => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    const set = (k: string, v: string) => {
      if (v) params.set(k, v);
      else params.delete(k);
    };
    set('member', memberId);
    set('d', dBunrui);
    set('from', from);
    set('to', to);
    set('owner', owner === 'me' ? currentUserId : owner === 'all' ? '' : owner);
    params.delete('page');
    startTransition(() => router.push(`/activities?${params.toString()}`));
  };

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="min-w-[160px]">
        <Input
          placeholder="会員ID K-0000000"
          value={memberId}
          onChange={(e) => setMemberId(e.target.value.toUpperCase())}
        />
      </div>
      <Select className="w-40" value={dBunrui} onChange={(e) => setDBunrui(e.target.value)}>
        <option value="">大分類: すべて</option>
        {bunruiList.map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
      </Select>
      <Select
        className="w-40"
        value={owner === currentUserId ? 'me' : owner === '' ? 'all' : owner}
        onChange={(e) => setOwner(e.target.value)}
      >
        <option value="all">担当: すべて</option>
        <option value="me">自分の対応</option>
      </Select>
      <div className="flex items-center gap-1">
        <Input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="w-40"
        />
        <span className="text-sm text-muted-foreground">〜</span>
        <Input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="w-40"
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? '検索中…' : '検索'}
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setMemberId('');
          setDBunrui('');
          setFrom('');
          setTo('');
          setOwner('all');
          startTransition(() => router.push('/activities'));
        }}
      >
        クリア
      </Button>
    </form>
  );
}
