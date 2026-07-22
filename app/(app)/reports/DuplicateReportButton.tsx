'use client';

/**
 * レポート一覧の各行に置く複製ボタン。
 * 複製後は編集画面へ遷移して、名前や公開範囲をすぐ調整できるようにする。
 */

import { duplicateReport } from '@/lib/domain/report_actions';
import { Copy } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

export function DuplicateReportButton({
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
    if (!window.confirm(`レポート「${reportName}」を複製します。よろしいですか？`)) return;
    startTransition(async () => {
      const res = await duplicateReport(reportId);
      if (res?.ok && res.id) {
        router.push(`/reports/${res.id}/edit`);
      } else {
        window.alert(res?.error ?? '複製に失敗しました');
      }
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-label="レポートを複製"
      title="レポートを複製"
      className="text-muted-foreground hover:text-primary disabled:opacity-50"
    >
      <Copy className="h-4 w-4" />
    </button>
  );
}
