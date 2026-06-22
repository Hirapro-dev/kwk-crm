'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { APP_STATUSES } from '@/lib/domain/applications_constants';

export function ApplicationsFilterBar({
  initialQ,
  initialProjectId,
  initialStatus,
  projects,
}: {
  initialQ: string;
  initialProjectId: string;
  initialStatus: string;
  projects: { id: number; name: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(initialQ);
  const [projectId, setProjectId] = useState(initialProjectId);
  const [status, setStatus] = useState(initialStatus);

  const submit = () => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (q) params.set('q', q);
    else params.delete('q');
    if (projectId) params.set('project', projectId);
    else params.delete('project');
    if (status) params.set('status', status);
    else params.delete('status');
    params.delete('page');
    startTransition(() => router.push(`/applications?${params.toString()}`));
  };

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex-1 min-w-[180px]">
        <Input
          placeholder="申込ID(M-)・会員ID(K-)で検索"
          value={q}
          onChange={(e) => setQ(e.target.value.toUpperCase())}
        />
      </div>
      <Select className="w-56" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
        <option value="">案件: すべて</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      <Select className="w-36" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">ステータス: すべて</option>
        {APP_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </Select>
      <Button type="submit" disabled={pending}>
        {pending ? '検索中…' : '検索'}
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setQ('');
          setProjectId('');
          setStatus('');
          startTransition(() => router.push('/applications'));
        }}
      >
        クリア
      </Button>
    </form>
  );
}
