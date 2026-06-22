/**
 * レポート実行・結果表示画面(仕様書 §8.1, §9.9)
 *
 * - 保存済みレポート定義を読み込んで Server Component 内で実行
 * - 結果テーブル(本実装)+ CSV/Excel ダウンロードリンク
 * - グラフは Phase 7 で(現状は表のみ)
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HighlightPanel } from '@/components/layout/HighlightPanel';
import { ReportResultView } from '@/components/reports/ReportResultView';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/domain/auth';
import { getReport } from '@/lib/domain/reports';
import { logReportRun } from '@/lib/domain/report_actions';
import { executeReport } from '@/lib/reports/execute_v2';
import {
  SUMMARY_AGG_LABEL,
  aggregateColumn,
  formatSummaryValue,
} from '@/lib/reports/summary';
import { REPORT_TYPES } from '@/lib/reports/types';
import { formatDateTime } from '@/lib/utils/date';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ReportRunPage({ params }: PageProps) {
  const { id } = await params;
  const report = await getReport(id);
  if (!report) notFound();
  const me = await getCurrentUser();

  const res = await executeReport(
    report.report_type === 'custom' ? 'RT01' : report.report_type,
    report.definition,
    me.id,
  );

  // 実行履歴を記録(失敗してもページは表示)
  await logReportRun({
    report_id: report.id,
    duration_ms: res.ok ? res.durationMs : 0,
    row_count: res.ok ? res.rowCount : 0,
    status: res.ok ? 'success' : 'error',
    error_message: res.ok ? undefined : res.error,
  });

  const typeMeta =
    REPORT_TYPES[report.report_type as keyof typeof REPORT_TYPES] ?? null;
  const canEdit = !report.is_standard || me.role === 'admin';

  // #画像1: サマリー指標が設定されていれば、ヘッダー帯を「件数 + 指定集計値」に置き換える。
  // 未設定なら従来のメタ情報(タイプ/カテゴリ/区分/件数・実行時間)を表示。
  const summaries = report.definition.display?.summaries ?? [];
  let panelFacts: Array<{ label: string; value: ReactNode }>;
  if (res.ok && summaries.length > 0) {
    panelFacts = [{ label: '件数', value: `${res.rowCount.toLocaleString()}件` }];
    for (const s of summaries) {
      const col = res.columns.find((c) => c.id === s.columnId);
      if (!col) continue;
      panelFacts.push({
        label: `${col.label} の${SUMMARY_AGG_LABEL[s.aggregate]}`,
        value: formatSummaryValue(
          aggregateColumn(res.rows, col.alias, s.aggregate),
          s.aggregate,
        ),
      });
    }
  } else {
    panelFacts = [
      { label: 'タイプ', value: <Badge variant="outline">{report.report_type}</Badge> },
      { label: 'カテゴリ', value: typeMeta?.name ?? '-' },
      {
        label: '区分',
        value: report.is_standard ? (
          <Badge variant="success">標準</Badge>
        ) : (
          <Badge variant="secondary">{report.visibility}</Badge>
        ),
      },
      {
        label: '件数 / 実行時間',
        value: res.ok
          ? `${res.rowCount.toLocaleString()}件 · ${res.durationMs.toLocaleString()}ms`
          : '-',
      },
    ];
  }

  return (
    <div className="space-y-3">
      {/* パンくず + 実行日時(右上) */}
      <div className="flex items-center justify-between gap-2">
        <Link href="/reports" className="sf-back-link text-xs text-white">
          ← レポート一覧へ
        </Link>
        {res.ok && (
          <p className="text-xs text-white">
            実行: {formatDateTime(new Date().toISOString())}
            {res.truncated && (
              <Badge variant="destructive" className="ml-2">
                上限到達(Excel で取得を推奨)
              </Badge>
            )}
          </p>
        )}
      </div>

      {/* Highlight Panel: 他オブジェクト詳細ページと同じカード形式ヘッダー */}
      <HighlightPanel
        iconLabel="RPT"
        iconColor="#9333ea"
        objectLabel="レポート"
        recordName={report.name}
        recordSubName={report.description ?? undefined}
        facts={panelFacts}
        actions={
          <>
            {canEdit && (
              <Link href={`/reports/${report.id}/edit`}>
                <Button variant="outline" size="sm">
                  編集
                </Button>
              </Link>
            )}
            <Link href={`/reports/${report.id}/export?format=csv`}>
              <Button variant="outline" size="sm">
                CSV ダウンロード
              </Button>
            </Link>
            <Link href={`/reports/${report.id}/export?format=xlsx`}>
              <Button variant="outline" size="sm">
                Excel ダウンロード
              </Button>
            </Link>
          </>
        }
      />

      {!res.ok ? (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-destructive">{res.error}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* グラフ・サマリー・グルーピング(クライアント側で描画)。
              サマリー指標はヘッダー帯に出すため本体チップは非表示。 */}
          <ReportResultView
            columns={res.columns}
            rows={res.rows}
            chart={report.definition.chart}
            display={report.definition.display}
            showSummaryChips={false}
          />
        </>
      )}
    </div>
  );
}
