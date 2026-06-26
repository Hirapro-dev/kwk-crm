'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

export function AuditLogFilterBar({
  initialTable,
  initialAction,
  initialActor,
  initialFrom,
  initialTo,
  actorOptions,
}: {
  initialTable: string;
  initialAction: string;
  initialActor: string;
  initialFrom: string;
  initialTo: string;
  actorOptions: { id: string; name: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [table, setTable] = useState(initialTable);
  const [action, setAction] = useState(initialAction);
  const [actor, setActor] = useState(initialActor);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);

  const submit = () => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    const set = (k: string, v: string) => {
      if (v) params.set(k, v);
      else params.delete(k);
    };
    set('table', table);
    set('action', action);
    set('actor', actor);
    set('from', from);
    set('to', to);
    startTransition(() => router.push(`/settings/audit-log?${params.toString()}`));
  };

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Select className="w-36" value={table} onChange={(e) => setTable(e.target.value)}>
        <option value="">対象: すべて</option>
        <option value="members">会員</option>
        <option value="applications">申込</option>
        <option value="activities">対応歴</option>
        <option value="users">ユーザー</option>
      </Select>
      <Select className="w-32" value={action} onChange={(e) => setAction(e.target.value)}>
        <option value="">操作: すべて</option>
        <option value="INSERT">作成</option>
        <option value="UPDATE">編集</option>
        <option value="DELETE">削除(物理)</option>
      </Select>
      <Select className="w-44" value={actor} onChange={(e) => setActor(e.target.value)}>
        <option value="">実行者: すべて</option>
        {actorOptions.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
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
          setTable('');
          setAction('');
          setActor('');
          setFrom('');
          setTo('');
          startTransition(() => router.push('/settings/audit-log'));
        }}
      >
        クリア
      </Button>
    </form>
  );
}
