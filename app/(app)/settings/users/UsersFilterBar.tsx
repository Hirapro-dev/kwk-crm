'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { Select } from '@/components/ui/select';

const ROLES = ['admin', 'manager', 'sales', 'viewer'] as const;

/**
 * ユーザー一覧のフィルター(表示=有効のみ/すべて, 権限)。
 * 既定は「有効のみ」(active パラメータ無し)。選択を変えると即URL反映。
 */
export function UsersFilterBar({
  initialActive,
  initialRole,
}: {
  /** 'active'(有効のみ) | 'all'(すべて) */
  initialActive: 'active' | 'all';
  /** '' = すべて、または role 名 */
  initialRole: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const update = (key: 'active' | 'role', value: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (value) params.set(key, value);
    else params.delete(key);
    const qs = params.toString();
    startTransition(() => router.push(qs ? `/settings/users?${qs}` : '/settings/users'));
  };

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
      <Select
        className="w-36"
        value={initialActive}
        onChange={(e) => update('active', e.target.value === 'all' ? 'all' : '')}
      >
        <option value="active">有効のみ</option>
        <option value="all">すべて</option>
      </Select>
      <Select
        className="w-40"
        value={initialRole}
        onChange={(e) => update('role', e.target.value)}
      >
        <option value="">権限: すべて</option>
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </Select>
    </div>
  );
}
