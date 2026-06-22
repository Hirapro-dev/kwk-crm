'use client';

/**
 * レポート結果ビュー(仕様書 §9.6 / §9.9)
 *
 * Salesforce サマリーレポート相当の結果表示。結果ページとビルダープレビューで共用。
 *   #1 グラフの棒/スライスをクリックすると、そのカテゴリの行だけに絞り込む(解除可)
 *   #2 表示グルーピング: グループ列はセル結合(rowspan)で区切る
 *   #3 グループ小計 + 総計。下部トグルバーで 行数/詳細行/小計/総計 を表示切替
 *   #4 カスタムサマリー指標は結果ページのヘッダー帯に表示(showSummaryChips=false で本体非表示)
 *
 * 集計はすべて取得済みの結果行に対して行う(追加 SQL なし)。
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ReportChart } from '@/components/reports/ReportChart';
import { MEMBER_LINK_ID_ALIAS } from '@/lib/reports/builder_v2';
import { computeChartData } from '@/lib/reports/chart_data';
import {
  SUMMARY_AGG_LABEL,
  aggregateColumn,
  formatSummaryValue,
} from '@/lib/reports/summary';
import type { ReportChartConfig, ReportDisplayConfig } from '@/lib/reports/types';
import { cn } from '@/lib/utils/cn';
import { formatDateTime } from '@/lib/utils/date';

export interface ReportColumnView {
  id: string;
  label: string;
  alias: string;
  source: string;
}

interface Props {
  columns: ReportColumnView[];
  rows: Array<Record<string, unknown>>;
  chart?: ReportChartConfig | null;
  display?: ReportDisplayConfig | null;
  /** サマリー指標チップを本体に表示するか(結果ページはヘッダーに出すため false) */
  showSummaryChips?: boolean;
}

/** カテゴリ/グループ表示名(空は "(空白)") */
function displayKey(v: unknown): string {
  return v === null || v === undefined || v === '' ? '(空白)' : String(v);
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return formatDateTime(v);
    }
    return v;
  }
  if (typeof v === 'number') return Number(v).toLocaleString();
  if (typeof v === 'boolean') return v ? '✓' : '';
  return JSON.stringify(v);
}

export function ReportResultView({
  columns,
  rows,
  chart,
  display,
  showSummaryChips = true,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  // 下部トグル(画像3): 行数 / 詳細行 / 小計 / 総計
  const [showCounts, setShowCounts] = useState(true);
  const [showDetail, setShowDetail] = useState(true);
  const [showSubtotal, setShowSubtotal] = useState(false);
  const [showGrandTotal, setShowGrandTotal] = useState(true);

  const colById = useMemo(() => {
    const m = new Map<string, ReportColumnView>();
    for (const c of columns) m.set(c.id, c);
    return m;
  }, [columns]);

  // ----- グラフ用データ(全行ベース。クリックで table を絞り込む) -----
  const chartData = useMemo(
    () => (chart ? computeChartData(rows, columns, chart) : null),
    [chart, rows, columns],
  );
  const chartCatAlias = chart ? colById.get(chart.categoryColumnId)?.alias : undefined;

  // ----- 選択カテゴリで絞り込んだ行 -----
  const filteredRows = useMemo(() => {
    if (!selected || !chartCatAlias) return rows;
    return rows.filter((r) => displayKey(r[chartCatAlias]) === selected);
  }, [rows, selected, chartCatAlias]);

  // ----- サマリー指標(小計 / 総計 / ヘッダーで使う) -----
  const summaries = display?.summaries ?? [];
  const aggByColId = useMemo(() => {
    const m = new Map<string, (typeof summaries)[number]['aggregate']>();
    for (const s of summaries) if (!m.has(s.columnId)) m.set(s.columnId, s.aggregate);
    return m;
  }, [summaries]);
  const hasSummary = aggByColId.size > 0;

  // ----- 表示グルーピング -----
  const groupCol = display?.groupByColumnId
    ? colById.get(display.groupByColumnId)
    : undefined;
  const groupColIndex = groupCol
    ? columns.findIndex((c) => c.id === groupCol.id)
    : -1;

  const groups = useMemo(() => {
    if (!groupCol) return null;
    const out: Array<{ key: string; rows: Array<Record<string, unknown>> }> = [];
    const idx = new Map<string, number>();
    for (const r of filteredRows) {
      const key = displayKey(r[groupCol.alias]);
      let i = idx.get(key);
      if (i === undefined) {
        i = out.length;
        idx.set(key, i);
        out.push({ key, rows: [] });
      }
      out[i]!.rows.push(r);
    }
    return out;
  }, [groupCol, filteredRows]);

  // ----- 小計/総計行: ラベルは labelColIndex(グループ列) に出す -----
  const renderSummaryRow = (
    groupRows: Array<Record<string, unknown>>,
    label: string,
    variant: 'subtotal' | 'grandtotal',
    labelColIndex: number,
  ) => (
    <TableRow
      className={
        variant === 'grandtotal'
          ? 'bg-slate-100 font-bold'
          : 'bg-slate-50 font-medium'
      }
    >
      {columns.map((c, i) => {
        const agg = aggByColId.get(c.id);
        let content = '';
        const isLabelCell = i === labelColIndex || (labelColIndex < 0 && i === 0);
        if (isLabelCell) {
          content = showCounts ? `${label} (${groupRows.length}件)` : label;
        } else if (agg) {
          content = `${SUMMARY_AGG_LABEL[agg]}: ${formatSummaryValue(
            aggregateColumn(groupRows, c.alias, agg),
            agg,
          )}`;
        }
        return (
          <TableCell key={c.alias} className="whitespace-nowrap text-xs">
            {content}
          </TableCell>
        );
      })}
    </TableRow>
  );

  // ----- 詳細セル1つ分(会員氏名はリンク) -----
  const renderDetailCell = (row: Record<string, unknown>, c: ReportColumnView) => {
    const memberId = row[MEMBER_LINK_ID_ALIAS];
    const text = formatCell(row[c.alias]);
    const linkable = c.source === 'm.name' && memberId != null && text !== '';
    return (
      <TableCell key={c.alias} className="whitespace-nowrap text-xs">
        {linkable ? (
          <Link
            href={`/members/${encodeURIComponent(String(memberId))}`}
            className="text-primary hover:underline"
          >
            {text}
          </Link>
        ) : (
          text
        )}
      </TableCell>
    );
  };
  const renderCells = (row: Record<string, unknown>) =>
    columns.map((c) => renderDetailCell(row, c));

  // グループ結合セル(rowspan)。key は配置先のグループ列に合わせる。
  const groupMergedCell = (g: { key: string; rows: unknown[] }, key: string) => (
    <TableCell
      key={key}
      rowSpan={g.rows.length}
      className="whitespace-nowrap border-r bg-slate-50/60 align-top text-xs font-semibold text-slate-800"
    >
      {g.key}
      {showCounts && (
        <span className="ml-1 font-normal text-muted-foreground">
          ({g.rows.length}件)
        </span>
      )}
    </TableCell>
  );

  // グループ列が表示列に無い場合のフォールバック見出し行
  const groupHeaderRow = (g: { key: string; rows: unknown[] }) => (
    <TableRow className="bg-primary/5 hover:bg-primary/5">
      <TableCell
        colSpan={columns.length}
        className="whitespace-nowrap text-xs font-bold text-slate-800"
      >
        {groupCol?.label}: {g.key}
        {showCounts && (
          <span className="ml-2 font-normal text-muted-foreground">
            {g.rows.length}件
          </span>
        )}
      </TableCell>
    </TableRow>
  );

  const labelColIndex = groupColIndex; // 小計/総計のラベル位置

  return (
    <div className="space-y-3">
      {/* #4 サマリー指標チップ(本体表示時のみ。結果ページはヘッダーに出す) */}
      {showSummaryChips && (
        <div className="flex flex-wrap gap-2">
          <SummaryChip label="件数" value={filteredRows.length.toLocaleString()} />
          {summaries.map((s, i) => {
            const col = colById.get(s.columnId);
            if (!col) return null;
            return (
              <SummaryChip
                key={`${s.columnId}-${s.aggregate}-${i}`}
                label={`${col.label} の${SUMMARY_AGG_LABEL[s.aggregate]}`}
                value={formatSummaryValue(
                  aggregateColumn(filteredRows, col.alias, s.aggregate),
                  s.aggregate,
                )}
              />
            );
          })}
        </div>
      )}

      {/* グラフ(クリックで絞り込み) */}
      {chart && chartData && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">グラフ</CardTitle>
            {selected && (
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded border px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
              >
                絞り込み解除「{selected}」✕
              </button>
            )}
          </CardHeader>
          <CardContent>
            <ReportChart
              type={chart.type}
              chartData={chartData}
              title={chart.title}
              onCategoryClick={
                chartCatAlias
                  ? (name) => setSelected((cur) => (cur === name ? null : name))
                  : undefined
              }
              activeCategory={selected}
            />
            {chartCatAlias && (
              <p className="mt-1 text-center text-[10px] text-muted-foreground">
                棒・スライスをクリックするとそのカテゴリだけに絞り込めます
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* 結果テーブル */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">結果</CardTitle>
          {selected && (
            <span className="text-xs text-muted-foreground">
              絞り込み中: {selected}（{filteredRows.length.toLocaleString()}件）
            </span>
          )}
        </CardHeader>
        <CardContent>
          <div className="max-h-[640px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((c) => (
                    <TableHead key={c.alias} className="whitespace-nowrap text-xs">
                      {c.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="text-center text-sm text-muted-foreground"
                    >
                      該当データなし
                    </TableCell>
                  </TableRow>
                ) : groups ? (
                  // #2/#3 グループ表示(グループ列はセル結合)
                  <>
                    {groups.map((g) => {
                      const merged = groupColIndex >= 0;
                      return (
                        <GroupBlock
                          key={g.key}
                          group={g}
                          merged={merged}
                          columns={columns}
                          groupColIndex={groupColIndex}
                          showDetail={showDetail}
                          showSubtotal={showSubtotal && showDetail}
                          renderCells={renderCells}
                          renderDetailCell={renderDetailCell}
                          renderSummaryRow={(rows2, label) =>
                            renderSummaryRow(rows2, label, 'subtotal', labelColIndex)
                          }
                          groupMergedCell={groupMergedCell}
                          groupHeaderRow={groupHeaderRow}
                          collapsedRow={(grp) => (
                            <TableRow className="border-t-2 border-slate-300 bg-slate-50/40 font-medium">
                              {columns.map((c, ci) => {
                                if (ci === groupColIndex) {
                                  return (
                                    <TableCell
                                      key={c.alias}
                                      className="whitespace-nowrap text-xs font-semibold text-slate-800"
                                    >
                                      {grp.key}
                                      {showCounts && (
                                        <span className="ml-1 font-normal text-muted-foreground">
                                          ({grp.rows.length}件)
                                        </span>
                                      )}
                                    </TableCell>
                                  );
                                }
                                const agg = aggByColId.get(c.id);
                                return (
                                  <TableCell
                                    key={c.alias}
                                    className="whitespace-nowrap text-xs"
                                  >
                                    {agg
                                      ? `${SUMMARY_AGG_LABEL[agg]}: ${formatSummaryValue(
                                          aggregateColumn(grp.rows, c.alias, agg),
                                          agg,
                                        )}`
                                      : ''}
                                  </TableCell>
                                );
                              })}
                            </TableRow>
                          )}
                        />
                      );
                    })}
                    {/* 総計 */}
                    {showGrandTotal &&
                      renderSummaryRow(
                        filteredRows,
                        '総計',
                        'grandtotal',
                        labelColIndex,
                      )}
                  </>
                ) : (
                  // フラット表示
                  <>
                    {filteredRows.map((row, i) => (
                      <TableRow key={i}>{renderCells(row)}</TableRow>
                    ))}
                    {hasSummary &&
                      showGrandTotal &&
                      renderSummaryRow(filteredRows, '総計', 'grandtotal', 0)}
                  </>
                )}
              </TableBody>
            </Table>
          </div>

          {/* #3 下部トグルバー(グループ表示時) */}
          {groups && (
            <div className="mt-2 flex flex-wrap items-center gap-4 border-t pt-2">
              <ToggleSwitch label="行数" checked={showCounts} onChange={setShowCounts} />
              <ToggleSwitch label="詳細行" checked={showDetail} onChange={setShowDetail} />
              <ToggleSwitch
                label="小計"
                checked={showSubtotal}
                onChange={setShowSubtotal}
                disabled={!showDetail || !hasSummary}
              />
              <ToggleSwitch
                label="総計"
                checked={showGrandTotal}
                onChange={setShowGrandTotal}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function GroupBlock({
  group,
  merged,
  columns,
  groupColIndex,
  showDetail,
  showSubtotal,
  renderCells,
  renderDetailCell,
  renderSummaryRow,
  groupMergedCell,
  groupHeaderRow,
  collapsedRow,
}: {
  group: { key: string; rows: Array<Record<string, unknown>> };
  merged: boolean;
  columns: ReportColumnView[];
  groupColIndex: number;
  showDetail: boolean;
  showSubtotal: boolean;
  renderCells: (row: Record<string, unknown>) => React.ReactNode;
  renderDetailCell: (
    row: Record<string, unknown>,
    c: ReportColumnView,
  ) => React.ReactNode;
  renderSummaryRow: (
    rows: Array<Record<string, unknown>>,
    label: string,
  ) => React.ReactNode;
  groupMergedCell: (
    g: { key: string; rows: unknown[] },
    key: string,
  ) => React.ReactNode;
  groupHeaderRow: (g: { key: string; rows: unknown[] }) => React.ReactNode;
  collapsedRow: (g: { key: string; rows: Array<Record<string, unknown>> }) => React.ReactNode;
}) {
  // 詳細行を隠す場合: グループごとに 1 行(値 + 集計)
  if (!showDetail) {
    return <>{collapsedRow(group)}</>;
  }

  // グループ列が表示列に無い → 見出し行スタイル
  if (!merged) {
    return (
      <>
        {groupHeaderRow(group)}
        {group.rows.map((row, i) => (
          <TableRow key={i}>{renderCells(row)}</TableRow>
        ))}
        {showSubtotal && renderSummaryRow(group.rows, '小計')}
      </>
    );
  }

  // セル結合スタイル(画像3): 結合セルは「グループ列の位置」に置く。
  // (先頭固定にすると、グループ列より前の列がずれるバグになる)
  return (
    <>
      {group.rows.map((row, i) => (
        <TableRow
          key={i}
          className={i === 0 ? 'border-t-2 border-slate-300' : undefined}
        >
          {columns.map((c, ci) => {
            if (ci === groupColIndex) {
              // 結合列: 先頭行のみ rowspan セル、以降は省略(rowspanでカバー)
              return i === 0 ? groupMergedCell(group, c.alias) : null;
            }
            return renderDetailCell(row, c);
          })}
        </TableRow>
      ))}
      {showSubtotal && renderSummaryRow(group.rows, '小計')}
    </>
  );
}

function SummaryChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border bg-card px-3 py-1.5 shadow-sm">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-bold tabular-nums">{value}</div>
    </div>
  );
}

function ToggleSwitch({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex items-center gap-1.5 text-xs',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      <span
        className={cn(
          'relative h-4 w-7 rounded-full transition-colors',
          checked ? 'bg-primary' : 'bg-slate-300',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all',
            checked ? 'left-[14px]' : 'left-0.5',
          )}
        />
      </span>
      <span className="select-none">{label}</span>
    </button>
  );
}
