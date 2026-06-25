'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { deleteMember } from '@/lib/domain/member_actions';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

interface Props {
  memberId: string;
  memberName: string;
}

/**
 * 会員を論理削除する (admin のみ表示)。
 * スマホでの誤操作防止に確認ダイアログを挟む。
 */
export function MemberDeleteButton({ memberId, memberName }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleDelete = () => {
    setError(null);
    startTransition(async () => {
      const result = await deleteMember(memberId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.push('/members');
    });
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-destructive hover:bg-destructive/10"
      >
        削除
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[90%] sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>会員を削除しますか？</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            「{memberName}」を削除します。
            <br />
            紐づく申込・対応歴の記録は残ります。この操作は元に戻せません。
          </p>

          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              キャンセル
            </Button>
            <Button
              onClick={handleDelete}
              disabled={pending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {pending ? '削除中...' : '削除する'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
