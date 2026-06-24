/**
 * サマリ画面 (横タブ「サマリ」)
 *
 * - 全ユーザー閲覧可
 * - sales ロールのスタッフごとに applications.acquirer_id を集計し、
 *   期間内の入金額・件数を表示
 * - 期間(payment_date) と 案件(project_id) でフィルター可能
 */

import { Suspense } from 'react';
import { PanelFilterBar, PanelHeader } from '@/components/layout/PanelHeader';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getSalesSummary, listProjectsForFilter } from '@/lib/domain/sales_summary';
import { normalizePreset, resolveDateRange } from '@/lib/utils/date_preset';
import { SalesBarChart } from './SalesBarChart';
import { SummaryFilterBar } from './SummaryFilterBar';

interface PageProps {
  searchParams: Promise<{
    preset?: string;
    from?: string;
    to?: string;
    project?: string;
  }>;
}

export default async function SummaryPage({ searchParams }: PageProps) {
  const sp = await searchParams;

  const preset = normalizePreset(sp.preset);
  const range = resolveDateRange(preset, sp.from ?? null, sp.to ?? null);
  const projectIdRaw = sp.project && sp.project !== 'all' ? sp.project : null;
  const projectId =
    projectIdRaw && /^\d+$/.test(projectIdRaw) ? Number.parseInt(projectIdRaw, 10) : null;

  const [summary, projects] = await Promise.all([
    getSalesSummary({
      paymentFrom: range.from,
      paymentTo: range.to,
      projectId,
    }),
    listProjectsForFilter(),
  ]);

  return (
    <div className="space-y-3">
      {/* サマリカード */}
      <div className="grid gap-3 md:grid-cols-2">
        <SummaryCard
          label="入金額 合計"
          value={`¥${summary.grandTotalAmount.toLocaleString()}`}
        />
        <SummaryCard
          label="入金件数 合計"
          value={`${summary.grandTotalCount.toLocaleString()} 件`}
        />
      </div>

      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel="SUM"
          iconColor="#00C896"
          viewName="ユーザー別 入金サマリ"
          totalCount={summary.rows.length}
        />

        <PanelFilterBar>
          <Suspense>
            <SummaryFilterBar
              projects={projects}
              initialPreset={preset}
              initialFrom={sp.from ?? ''}
              initialTo={sp.to ?? ''}
              initialProject={projectId ? String(projectId) : 'all'}
            />
          </Suspense>
        </PanelFilterBar>

        {/* 担当者 × 入金額 の棒グラフ。フィルタを反映した summary.rows をそのまま渡す */}
        <div className="border-b px-4 py-3">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            担当者別 入金額 (グラフ)
          </div>
          <SalesBarChart rows={summary.rows} />
        </div>

        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50 hover:bg-gray-50">
              <TableHead className="h-9">ユーザー名</TableHead>
              <TableHead className="h-9 text-right">入金額</TableHead>
              <TableHead className="h-9 text-right">入金件数</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="text-center text-sm text-muted-foreground"
                >
                  sales ロールのユーザーが登録されていません
                </TableCell>
              </TableRow>
            ) : (
              summary.rows.map((r) => (
                <TableRow key={r.user_id} className="sf-row-hover">
                  <TableCell className="py-2 font-medium">{r.user_name}</TableCell>
                  <TableCell className="py-2 text-right tabular-nums">
                    {r.total_payment_amount > 0
                      ? `¥${r.total_payment_amount.toLocaleString()}`
                      : '-'}
                  </TableCell>
                  <TableCell className="py-2 text-right tabular-nums">
                    {r.payment_count > 0 ? `${r.payment_count.toLocaleString()}` : '-'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border bg-card p-4 shadow-sm">
      <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-foreground">{value}</div>
    </div>
  );
}
