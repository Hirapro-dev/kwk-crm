'use client';

import { Button } from '@/components/ui/button';
import { toggleRegularContactSelf } from '@/lib/domain/member_actions';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

interface Props {
  memberId: string;
  /** 現在の定期連絡者の氏名(未設定なら null) */
  currentName: string | null;
  /** 現在の定期連絡者が自分自身かどうか */
  isSelf: boolean;
}

/**
 * 定期連絡者を「自分」にトグルするボタン(会員詳細の定期連絡者フィールドに表示)。
 * support/sales/admin/manager が使用可能(表示制御は呼び出し側)。
 * - 自分が担当: 「自分の担当を解除」
 * - 未設定 / 他人が担当: 「自分を定期連絡者にする」(引き継ぎ)
 */
export function RegularContactButton({ memberId, currentName, isSelf }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleToggle = () => {
    setError(null);
    startTransition(async () => {
      const result = await toggleRegularContactSelf(memberId);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={currentName ? '' : 'text-muted-foreground'}>{currentName ?? '未設定'}</span>
      <Button
        variant="outline"
        size="sm"
        onClick={handleToggle}
        disabled={pending}
        className="h-7 px-2 text-xs"
      >
        {pending ? '更新中…' : isSelf ? '自分の担当を解除' : '自分を定期連絡者にする'}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
