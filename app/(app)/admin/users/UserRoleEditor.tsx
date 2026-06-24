'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { updateUserRole } from '@/lib/domain/user_actions';

const ROLES = ['admin', 'manager', 'sales', 'viewer', 'support'] as const;

/**
 * ユーザー1名のロール・有効状態を更新する小フォーム(admin限定 / 仕様書 §7.1)。
 */
export function UserRoleEditor({
  userId,
  initialRole,
  initialActive,
  isSelf,
}: {
  userId: string;
  initialRole: (typeof ROLES)[number];
  initialActive: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [role, setRole] = useState<string>(initialRole);
  const [isActive, setIsActive] = useState(initialActive);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const dirty = role !== initialRole || isActive !== initialActive;

  const submit = () => {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await updateUserRole({
        user_id: userId,
        role,
        is_active: isActive,
      });
      if (!res.ok) {
        setError(res.error ?? '更新失敗');
        return;
      }
      setSuccess('更新しました');
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-2">
      <Select
        className="w-28"
        value={role}
        onChange={(e) => setRole(e.target.value)}
        disabled={pending}
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </Select>
      <label className="flex items-center gap-1 text-xs">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          disabled={pending}
        />
        有効
      </label>
      <Button size="sm" onClick={submit} disabled={!dirty || pending}>
        {pending ? '…' : '保存'}
      </Button>
      {isSelf && <span className="text-xs text-muted-foreground">(自分)</span>}
      {error && <span className="text-xs text-destructive">{error}</span>}
      {success && <span className="text-xs text-green-700">{success}</span>}
    </div>
  );
}
