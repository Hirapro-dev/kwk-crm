/**
 * サマリ画面 (横タブ「サマリ」)
 *
 * タブ:
 *   - 入金 (payment): sales ロール別 applications.acquirer_id 集計
 *   - 新規顧客取得 (customers): members.info_acquired_date 別 新規取得数集計
 *
 * 各タブは URL クエリ ?tab= で切り替え。各タブのフィルタは独立したクエリパラメータ。
 */

import { PanelFilterBar, PanelHeader } from '@/components/layout/PanelHeader';
import { ReportChart } from '@/components/reports/ReportChart';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getNewCustomerSummary } from '@/lib/domain/customer_summary';
import { getSalesSummary, listProjectsForFilter } from '@/lib/domain/sales_summary';
import { cn } from '@/lib/utils/cn';
import { GRANULARITY_LABELS, normalizeGranularity } from '@/lib/utils/date_bucket';
import { normalizePreset, resolveDateRange } from '@/lib/utils/date_preset';
import Link from 'next/link';
import { Suspense } from 'react';
import { CustomerSummaryFilterBar } from './CustomerSummaryFilterBar';
import { SalesBarChart } from './SalesBarChart';
import { SummaryFilterBar } from './SummaryFilterBar';

type SP = Record<string, string | undefined>;

interface PageProps {
  searchParams: Promise<SP>;
}

const TABS = [
  { key: 'payment', label: '入金' },
  { key: 'customers', label: '新規顧客取得' },
] as const;

export default async function SummaryPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const tab = sp.tab === 'customers' ? 'customers' : 'payment';

  return (
    <div className="space-y-3">
      {/* タブナビ */}
      <div className="flex gap-1 border-b">
        {TABS.map((t) => {
          const params = new URLSearchParams();
          if (t.key !== 'payment') params.set('tab', t.key);
          const href = params.toString() ? `/summary?${params.toString()}` : '/summary';
          return (
            <Link
              key={t.key}
              href={href}
              className={cn(
                '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                tab === t.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      {tab === 'customers' ? <CustomerTab sp={sp} /> : <PaymentTab sp={sp} />}
    </div>
  );
}

/* ===================== 入金タブ(既存) ===================== */
async function PaymentTab({ sp }: { sp: SP }) {
  const preset = sp.preset ? normalizePreset(sp.preset) : 'this_month';
  const range = resolveDateRange(preset, sp.from ?? null, sp.to ?? null);
  const projectIdRaw = sp.project && sp.project !== 'all' ? sp.project : null;
  const projectId =
    projectIdRaw && /^\d+$/.test(projectIdRaw) ? Number.parseInt(projectIdRaw, 10) : null;

  const rawActive = sp.active ?? 'all';
  const activeFilter: 'all' | 'active' | 'inactive' =
    rawActive === 'active' || rawActive === 'inactive' ? rawActive : 'all';

  const [summary, projects] = await Promise.all([
    getSalesSummary({
      paymentFrom: range.from,
      paymentTo: range.to,
      projectId,
      activeFilter,
    }),
    listProjectsForFilter(),
  ]);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <SummaryCard label="入金額 合計" value={`¥${summary.grandTotalAmount.toLocaleString()}`} />
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
              initialActive={activeFilter}
            />
          </Suspense>
        </PanelFilterBar>

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
                <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
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

/* ===================== 新規顧客取得タブ ===================== */
async function CustomerTab({ sp }: { sp: SP }) {
  const preset = sp.cpreset ? normalizePreset(sp.cpreset) : 'this_month';
  const range = resolveDateRange(preset, sp.cfrom ?? null, sp.cto ?? null);
  const granularity = normalizeGranularity(sp.gran);
  const filters = {
    phoneAcquired: sp.fp === '1',
    emailOnly: sp.fe === '1',
    unpaid: sp.fu === '1',
  };

  const result = await getNewCustomerSummary({
    from: range.from,
    to: range.to,
    granularity,
    filters,
  });

  const chartData = {
    data: result.buckets.map((b) => ({ name: b.label, value: b.count })),
    categoryLabel: '期間',
    valueLabel: '新規取得数',
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <SummaryCard
          label="新規個人情報取得数 合計"
          value={`${result.total.toLocaleString()} 件`}
        />
        <SummaryCard label="表示粒度" value={GRANULARITY_LABELS[granularity]} />
      </div>

      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel="NEW"
          iconColor="#00C896"
          viewName="新規顧客取得サマリ"
          totalCount={result.buckets.length}
        />

        <PanelFilterBar>
          <Suspense>
            <CustomerSummaryFilterBar
              preset={preset}
              from={sp.cfrom ?? ''}
              to={sp.cto ?? ''}
              granularity={granularity}
              phoneAcquired={filters.phoneAcquired}
              emailOnly={filters.emailOnly}
              unpaid={filters.unpaid}
            />
          </Suspense>
        </PanelFilterBar>

        <div className="border-b px-4 py-3">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            新規取得数 ({GRANULARITY_LABELS[granularity]})
          </div>
          {result.buckets.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              該当する新規取得データがありません
            </p>
          ) : (
            <ReportChart type="bar_vertical" chartData={chartData} height={320} />
          )}
        </div>

        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50 hover:bg-gray-50">
              <TableHead className="h-9">期間</TableHead>
              <TableHead className="h-9 text-right">新規取得数</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.buckets.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2} className="text-center text-sm text-muted-foreground">
                  該当データがありません
                </TableCell>
              </TableRow>
            ) : (
              result.buckets.map((b) => (
                <TableRow key={b.key} className="sf-row-hover">
                  <TableCell className="py-2 font-medium">{b.label}</TableCell>
                  <TableCell className="py-2 text-right tabular-nums">
                    {b.count.toLocaleString()}
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
