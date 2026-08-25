'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * 一覧からの削除 (単体・一括) の確認ダイアログ。
 *
 * 会員詳細の MemberDeleteButton と同じ体裁にそろえる。
 * スマホでの誤操作防止のため、件数と対象名を明示してから確定させる。
 */
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 削除対象の件数 */
  count: number;
  /** オブジェクトの表示名 (例:「会員」「問合せ」) */
  objectLabel: string;
  /** 1件だけのときに表示する対象名 (氏名・IDなど)。省略可。 */
  targetLabel?: string;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  count,
  objectLabel,
  targetLabel,
  pending,
  error,
  onConfirm,
}: Props) {
  const isSingle = count === 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90%] sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>
            {isSingle
              ? `${objectLabel}を削除しますか？`
              : `${objectLabel} ${count.toLocaleString()} 件を削除しますか？`}
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          {isSingle && targetLabel ? (
            <>
              「{targetLabel}」を削除します。
              <br />
            </>
          ) : (
            <>
              選択中の {count.toLocaleString()} 件を削除します。
              <br />
            </>
          )}
          紐づく記録は残ります。この操作は元に戻せません。
        </p>

        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            キャンセル
          </Button>
          <Button
            onClick={onConfirm}
            disabled={pending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {pending ? '削除中...' : '削除する'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
