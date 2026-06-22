'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

export function InquiriesFilterBar({
  initialQ,
  initialFormId,
  initialUnassigned,
  forms,
}: {
  initialQ: string;
  initialFormId: string;
  initialUnassigned: boolean;
  forms: { id: number; name: string; category: string | null }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(initialQ);
  const [formId, setFormId] = useState(initialFormId);
  const [unassigned, setUnassigned] = useState(initialUnassigned);

  const submit = () => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (q) params.set('q', q);
    else params.delete('q');
    if (formId) params.set('form', formId);
    else params.delete('form');
    if (unassigned) params.set('unassigned', '1');
    else params.delete('unassigned');
    params.delete('page');
    startTransition(() => router.push(`/inquiries?${params.toString()}`));
  };

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex-1 min-w-[200px]">
        <Input
          placeholder="ID・氏名・メール・電話で検索"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <Select className="w-64" value={formId} onChange={(e) => setFormId(e.target.value)}>
        <option value="">フォーム: すべて</option>
        {forms.map((f) => (
          <option key={f.id} value={f.id}>
            [{f.category ?? '-'}] {f.name}
          </option>
        ))}
      </Select>
      <label className="flex items-center gap-1 text-sm">
        <input
          type="checkbox"
          checked={unassigned}
          onChange={(e) => setUnassigned(e.target.checked)}
        />
        会員化前のみ
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? '検索中…' : '検索'}
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setQ('');
          setFormId('');
          setUnassigned(false);
          startTransition(() => router.push('/inquiries'));
        }}
      >
        クリア
      </Button>
    </form>
  );
}
