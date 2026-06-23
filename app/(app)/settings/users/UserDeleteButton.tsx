'use client';

import { Button } from '@/components/ui/button';
import { deleteUser } from '@/lib/domain/user_actions';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * ユーザー1名を論理削除する(admin限定 / 物理削除はしない)。
 * 自分自身は削除不可。誤操作防止に確認ダイアログを挟む。
 */
export function UserDeleteButton({
  userId,
  userName,
  isSelf,
  redirectTo,
}: {
  userId: string;
  userName: string;
  isSelf: boolean;
  /** 削除後の遷移先。未指定なら一覧をその場で再取得 */
  redirectTo?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (isSelf) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }

  const onDelete = () => {
    if (
      !window.confirm(
        `「${userName}」を削除しますか?\n(担当として紐づく会員・対応歴の記録は残ります)`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await deleteUser({ user_id: userId });
      if (!res.ok) {
        setError(res.error ?? '削除に失敗しました');
        return;
      }
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={onDelete}
        disabled={pending}
        className="text-destructive hover:bg-destructive/10"
      >
        {pending ? '…' : '削除'}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
