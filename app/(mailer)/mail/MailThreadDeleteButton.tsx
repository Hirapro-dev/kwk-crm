'use client';

/**
 * スレッド詳細の削除ボタン(2026-10-22 ユーザー指定)。一覧の行のゴミ箱と同じく admin / manager だけに出し、
 * 確認のうえ論理削除する(deleteMailThreads。データは消さず非表示)。削除したら次のメール(無ければ一覧)へ移る。
 */

import { DeleteConfirmDialog } from '@/components/layout/DeleteConfirmDialog';
import { Button } from '@/components/ui/button';
import { deleteMailThreads } from '@/lib/domain/mail_actions';
import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

export function MailThreadDeleteButton({
  threadId,
  afterHref,
}: {
  threadId: string;
  /** 削除後に開く画面(次のメール、無ければ一覧) */
  afterHref: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const confirm = () => {
    setError(null);
    startTransition(async () => {
      const r = await deleteMailThreads([threadId]);
      if (r.error) {
        setError(r.error);
        return;
      }
      setOpen(false);
      router.push(afterHref);
      router.refresh();
    });
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="text-red-700 hover:bg-red-50"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
        削除
      </Button>
      <DeleteConfirmDialog
        open={open}
        onOpenChange={(o) => !pending && setOpen(o)}
        count={1}
        objectLabel="メール"
        pending={pending}
        error={error}
        onConfirm={confirm}
      />
    </>
  );
}
