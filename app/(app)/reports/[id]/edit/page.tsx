/**
 * レポート編集画面(仕様書 §8.1, §9.10)
 */

import { Badge } from '@/components/ui/badge';
import { getCurrentUser } from '@/lib/domain/auth';
import { getReport } from '@/lib/domain/reports';
import { listAllUsers } from '@/lib/domain/users_admin';
import { loadExtraColumnsForReportType } from '@/lib/reports/extra_columns';
import type { ReportTypeId } from '@/lib/reports/types';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ReportBuilder } from '../../builder/ReportBuilder';

// extra 項目(field_definitions)を毎回最新で読み込むため常に動的レンダリング
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditReportPage({ params }: PageProps) {
  const { id } = await params;
  const report = await getReport(id);
  if (!report) notFound();
  const me = await getCurrentUser();
  if (report.is_standard && me.role !== 'admin') {
    redirect(`/reports/${id}`);
  }

  // 主軸オブジェクトの extra jsonb キーを field_definitions からロード
  const extraColumns = await loadExtraColumnsForReportType(report.report_type as ReportTypeId);

  // 「指定ユーザーのみ」は admin のみ設定可
  const canRestrict = me.role === 'admin';
  const assignableUsers = canRestrict
    ? (await listAllUsers({ activeOnly: true })).map((u) => ({ id: u.id, full_name: u.full_name }))
    : [];

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/reports/${id}`} className="sf-back-link text-sm">
          ← 実行画面へ戻る
        </Link>
        <h1 className="text-2xl font-semibold">
          編集: <Badge>{report.report_type}</Badge> {report.name}
        </h1>
      </div>
      <ReportBuilder
        reportType={report.report_type as ReportTypeId}
        initial={{
          id: report.id,
          name: report.name,
          description: report.description ?? undefined,
          visibility: report.visibility,
          shared_with: report.shared_with,
          definition: report.definition,
        }}
        extraColumns={extraColumns}
        canRestrict={canRestrict}
        assignableUsers={assignableUsers}
      />
    </div>
  );
}
