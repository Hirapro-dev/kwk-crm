'use client';

import { Select } from '@/components/ui/select';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

/** 有効/無効フィルタ。デフォルトは有効のみ表示。 */
export function AccessLogFilterBar({ initialStatus }: { initialStatus: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const onChange = (value: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (value === 'active') params.delete('status');
    else params.set('status', value);
    startTransition(() => router.push(`/settings/access-log?${params.toString()}`));
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">状態:</span>
      <Select
        className="w-36"
        value={initialStatus}
        onChange={(e) => onChange(e.target.value)}
        disabled={pending}
      >
        <option value="active">有効のみ</option>
        <option value="inactive">無効のみ</option>
        <option value="all">すべて</option>
      </Select>
    </div>
  );
}
