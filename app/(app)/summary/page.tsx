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
import { getCurrentUser } from '@/lib/domain/auth';
import { getNewCustomerSummary, listInfoAcquiredPoints } from '@/lib/domain/customer_summary';
import { getFormSummary, listFormsForSummary } from '@/lib/domain/form_summary';
import { getSalesSummary, listProjectsForFilter } from '@/lib/domain/sales_summary';
import { listSummaryFavorites } from '@/lib/domain/summary_favorites';
import { cn } from '@/lib/utils/cn';
import { GRANULARITY_LABELS, normalizeGranularity } from '@/lib/utils/date_bucket';
import { normalizePreset, resolveDateRange } from '@/lib/utils/date_preset';
import Link from 'next/link';
import { Suspense } from 'react';
import { CustomerSummaryFilterBar } from './CustomerSummaryFilterBar';
import { FormSummaryFilterBar } from './FormSummaryFilterBar';
import { SalesBarChart } from './SalesBarChart';
import { SaveFavoriteButton } from './SaveFavoriteButton';
import { SummaryFavoritesButton } from './SummaryFavoritesButton';
import { SummaryFilterBar } from './SummaryFilterBar';

type SP = Record<string, string | undefined>;

interface PageProps {
  searchParams: Promise<SP>;
}

const TABS = [
  { key: 'payment', label: '入金' },
  { key: 'customers', label: '新規顧客取得' },
  { key: 'forms', label: 'フォーム集計' },
] as const;

export default async function SummaryPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const tab = sp.tab === 'customers' ? 'customers' : sp.tab === 'forms' ? 'forms' : 'payment';

  const [me, favorites] = await Promise.all([getCurrentUser(), listSummaryFavorites()]);

  return (
    <Card className="overflow-hidden p-0 shadow-sm">
      {/* 上部: サマリタブ + お気に入りボタン */}
      <div className="flex items-center justify-between gap-2 border-b bg-gray-50/60 px-4 pt-2">
        <div className="flex gap-1">
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
        <div className="pb-1">
          <SummaryFavoritesButton favorites={favorites} currentUserId={me.id} />
        </div>
      </div>

      {tab === 'customers' ? (
        <CustomerTab sp={sp} />
      ) : tab === 'forms' ? (
        <FormTab sp={sp} />
      ) : (
        <PaymentTab sp={sp} />
      )}
    </Card>
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
    <>
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

      {/* 集計カード */}
      <div className="grid gap-3 border-b p-4 md:grid-cols-2">
        <SummaryCard label="入金額 合計" value={`¥${summary.grandTotalAmount.toLocaleString()}`} />
        <SummaryCard
          label="入金件数 合計"
          value={`${summary.grandTotalCount.toLocaleString()} 件`}
        />
      </div>

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
                  {r.total_payment_amount > 0 ? `¥${r.total_payment_amount.toLocaleString()}` : '-'}
                </TableCell>
                <TableCell className="py-2 text-right tabular-nums">
                  {r.payment_count > 0 ? `${r.payment_count.toLocaleString()}` : '-'}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </>
  );
}

/* ===================== 新規顧客取得タブ ===================== */
async function CustomerTab({ sp }: { sp: SP }) {
  const preset = sp.cpreset ? normalizePreset(sp.cpreset) : 'this_month';
  const range = resolveDateRange(preset, sp.cfrom ?? null, sp.cto ?? null);
  const granularity = normalizeGranularity(sp.gran);
  const selectedPoints = (sp.pts ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const axis: 'point' | 'member' = sp.axis === 'member' ? 'member' : 'point';
  const filters = {
    phoneAcquired: sp.fp === '1',
    emailOnly: sp.fe === '1',
    unpaid: sp.fu === '1',
    points: selectedPoints,
  };

  const [result, pointOptions] = await Promise.all([
    getNewCustomerSummary({ from: range.from, to: range.to, granularity, filters }),
    listInfoAcquiredPoints(),
  ]);

  const chartData = {
    data: result.buckets.map((b) => ({ name: b.label, value: b.count })),
    categoryLabel: '期間',
    valueLabel: '新規取得数',
  };

  return (
    <>
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
            pointOptions={pointOptions}
            selectedPoints={selectedPoints}
            axis={axis}
          />
        </Suspense>
      </PanelFilterBar>

      {/* 集計カード */}
      <div className="grid gap-3 border-b p-4 md:grid-cols-2">
        <SummaryCard
          label="新規個人情報取得数 合計"
          value={`${result.total.toLocaleString()} 件`}
        />
        <SummaryCard label="表示粒度" value={GRANULARITY_LABELS[granularity]} />
      </div>

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

      {/* 一覧: 軸切替(個人情報取得ポイント軸 / 会員氏名軸) */}
      {axis === 'member' ? (
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50 hover:bg-gray-50">
              <TableHead className="h-9">取得日</TableHead>
              <TableHead className="h-9">会員氏名</TableHead>
              <TableHead className="h-9">個人情報取得ポイント</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.members.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                  該当データがありません
                </TableCell>
              </TableRow>
            ) : (
              result.members.map((m) => (
                <TableRow key={m.id} className="sf-row-hover">
                  <TableCell className="whitespace-nowrap py-2 text-xs">
                    {m.info_acquired_date}
                  </TableCell>
                  <TableCell className="py-2">
                    <Link href={`/members/${m.id}`} className="sf-link font-medium">
                      {m.name ?? m.id}
                    </Link>
                  </TableCell>
                  <TableCell className="py-2 text-sm">{m.info_acquired_points ?? '-'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50 hover:bg-gray-50">
              <TableHead className="h-9">個人情報取得ポイント</TableHead>
              <TableHead className="h-9 text-right">新規取得数</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.pointBreakdown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2} className="text-center text-sm text-muted-foreground">
                  該当データがありません
                </TableCell>
              </TableRow>
            ) : (
              result.pointBreakdown.map((p) => (
                <TableRow key={p.point} className="sf-row-hover">
                  <TableCell className="py-2 font-medium">{p.point}</TableCell>
                  <TableCell className="py-2 text-right tabular-nums">
                    {p.count.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}
      {axis === 'member' && result.membersTruncated && (
        <p className="px-4 py-2 text-xs text-muted-foreground">
          ※ 会員氏名軸は最大1,000件まで表示します。期間や条件で絞り込んでください。
        </p>
      )}
    </>
  );
}

/* ===================== フォーム集計タブ ===================== */
async function FormTab({ sp }: { sp: SP }) {
  const preset = sp.fpreset ? normalizePreset(sp.fpreset) : 'this_month';
  const range = resolveDateRange(preset, sp.ffrom ?? null, sp.fto ?? null);
  const granularity = normalizeGranularity(sp.fgran);
  const mode: 'record' | 'unique' = sp.fmode === 'unique' ? 'unique' : 'record';
  const selectedForms = (sp.forms ?? '')
    .split(',')
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n));
  const formFilters = {
    phoneAcquired: sp.ffp === '1',
    emailOnly: sp.ffe === '1',
    unpaid: sp.ffu === '1',
  };

  const [result, formOptions] = await Promise.all([
    getFormSummary({
      from: range.from,
      to: range.to,
      granularity,
      formIds: selectedForms,
      filters: formFilters,
    }),
    listFormsForSummary(),
  ]);

  const buckets = mode === 'unique' ? result.uniqueBuckets : result.recordBuckets;
  const total = mode === 'unique' ? result.uniqueTotal : result.recordTotal;
  const valueLabel = mode === 'unique' ? 'ユニーク件数' : 'レコード件数';

  const chartData = {
    data: buckets.map((b) => ({ name: b.label, value: b.count })),
    categoryLabel: '期間',
    valueLabel,
  };

  const noForm = selectedForms.length === 0;

  return (
    <>
      <PanelHeader
        iconLabel="FRM"
        iconColor="#00C896"
        viewName="フォーム集計サマリ"
        totalCount={buckets.length}
        actions={<SaveFavoriteButton summaryType="forms" disabled={noForm} />}
      />

      <PanelFilterBar>
        <Suspense>
          <FormSummaryFilterBar
            preset={preset}
            from={sp.ffrom ?? ''}
            to={sp.fto ?? ''}
            granularity={granularity}
            formOptions={formOptions}
            selectedForms={selectedForms}
            mode={mode}
            phoneAcquired={formFilters.phoneAcquired}
            emailOnly={formFilters.emailOnly}
            unpaid={formFilters.unpaid}
          />
        </Suspense>
      </PanelFilterBar>

      {/* 集計カード */}
      <div className="grid gap-3 border-b p-4 md:grid-cols-3">
        <SummaryCard label={`${valueLabel} 合計`} value={`${total.toLocaleString()} 件`} />
        <SummaryCard label="選択フォーム数" value={`${selectedForms.length} 件`} />
        <SummaryCard label="表示粒度" value={GRANULARITY_LABELS[granularity]} />
      </div>

      {noForm ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          集計するフォームを選択してください（複数選択可）
        </p>
      ) : (
        <>
          <div className="border-b px-4 py-3">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              {valueLabel} ({GRANULARITY_LABELS[granularity]})
            </div>
            {buckets.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                該当するデータがありません
              </p>
            ) : (
              <ReportChart type="bar_vertical" chartData={chartData} height={320} />
            )}
          </div>

          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50 hover:bg-gray-50">
                <TableHead className="h-9">期間</TableHead>
                <TableHead className="h-9 text-right">{valueLabel}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {buckets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="text-center text-sm text-muted-foreground">
                    該当データがありません
                  </TableCell>
                </TableRow>
              ) : (
                buckets.map((b) => (
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
        </>
      )}
    </>
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
