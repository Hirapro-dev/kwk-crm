'use client';

/**
 * レポート一覧の各行に置く削除ボタン(論理削除)。
 * 重いレポート(1万件到達など)は詳細ページを開くと固まるため、
 * 一覧から直接削除できるようにする。確認ダイアログ付き。
 */

import { deleteReport } from '@/lib/domain/report_actions';
import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

export function DeleteReportButton({
  reportId,
  reportName,
}: {
  reportId: string;
  reportName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`レポート「${reportName}」を削除します。よろしいですか？`)) return;
    startTransition(async () => {
      const res = await deleteReport(reportId);
      if (res?.ok) {
        router.refresh();
      } else {
        window.alert(res?.error ?? '削除に失敗しました');
      }
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-label="レポートを削除"
      title="レポートを削除"
      className="text-muted-foreground hover:text-destructive disabled:opacity-50"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
