'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ACTIVITY_STATUS_FLAGS, CONTACT_CONTENTS } from '@/lib/domain/activities_types';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

export function ActivitiesFilterBar({
  initialMemberId,
  initialDBunrui,
  initialMBunrui,
  initialSBunrui,
  initialFrom,
  initialTo,
  bunruiList,
  currentUserId,
  initialOwner,
  ownerOptions,
}: {
  initialMemberId: string;
  initialDBunrui: string;
  initialMBunrui: string;
  initialSBunrui: string;
  initialFrom: string;
  initialTo: string;
  bunruiList: string[];
  currentUserId: string;
  initialOwner: string;
  /** 担当者フィルタの選択肢(対応者候補) */
  ownerOptions: { id: string; name: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [memberId, setMemberId] = useState(initialMemberId);
  const [dBunrui, setDBunrui] = useState(initialDBunrui);
  const [mBunrui, setMBunrui] = useState(initialMBunrui);
  const [sBunrui, setSBunrui] = useState(initialSBunrui);
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
    set('m', mBunrui);
    set('s', sBunrui);
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
      <Select className="w-44" value={mBunrui} onChange={(e) => setMBunrui(e.target.value)}>
        <option value="">接触内容: すべて</option>
        {CONTACT_CONTENTS.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>
      <Select className="w-36" value={sBunrui} onChange={(e) => setSBunrui(e.target.value)}>
        <option value="">状態: すべて</option>
        {ACTIVITY_STATUS_FLAGS.map((s) => (
          <option key={s} value={s}>
            {s}
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
        {ownerOptions
          .filter((u) => u.id !== currentUserId)
          .map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
      </Select>
      <div className="flex items-center gap-1">
        <Input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="w-40"
        />
        <span className="text-sm text-muted-foreground">〜</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
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
          setMBunrui('');
          setSBunrui('');
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
