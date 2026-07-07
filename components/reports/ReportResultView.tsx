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

import { ReportChart } from '@/components/reports/ReportChart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { MEMBER_LINK_ID_ALIAS } from '@/lib/reports/builder_v2';
import { computeChartData } from '@/lib/reports/chart_data';
import { categoryName, formatReportCell } from '@/lib/reports/format_cell';
import { SUMMARY_AGG_LABEL, aggregateColumn, formatSummaryValue } from '@/lib/reports/summary';
import type { ReportChartConfig, ReportDisplayConfig } from '@/lib/reports/types';
import { cn } from '@/lib/utils/cn';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

export interface ReportColumnView {
  id: string;
  label: string;
  alias: string;
  source: string;
  dataType: string;
}

interface Props {
  columns: ReportColumnView[];
  rows: Array<Record<string, unknown>>;
  chart?: ReportChartConfig | null;
  display?: ReportDisplayConfig | null;
  /** サマリー指標チップを本体に表示するか(結果ページはヘッダーに出すため false) */
  showSummaryChips?: boolean;
}

// セル整形は共通の formatReportCell を使用(テーブル/グラフ/グループで表示を一致)
const formatCell = formatReportCell;

/** ソート用に値を比較可能な形へ正規化する */
function compareValues(a: unknown, b: unknown, dataType?: string): number {
  const an = a === null || a === undefined || a === '';
  const bn = b === null || b === undefined || b === '';
  if (an && bn) return 0;
  if (an) return 1; // null は末尾
  if (bn) return -1;
  if (dataType === 'number') {
    const na = Number(String(a).replace(/[,¥\s]/g, ''));
    const nb = Number(String(b).replace(/[,¥\s]/g, ''));
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  }
  // date/datetime(ISO文字列)や text はそのまま文字列比較(ISOは辞書順=時系列)
  return String(a).localeCompare(String(b), 'ja');
}

export function ReportResultView({
  columns,
  rows,
  chart,
  display,
  showSummaryChips = true,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  // 列ヘッダークリックによる昇順/降順ソート(グラフの並びも連動)
  const [sort, setSort] = useState<{ colId: string; dir: 'asc' | 'desc' } | null>(null);
  // 下部トグル(画像3): 行数 / 詳細行 / 小計 / 総計
  const [showCounts, setShowCounts] = useState(true);
  const [showDetail, setShowDetail] = useState(true);
  const [showSubtotal, setShowSubtotal] = useState(false);
  const [showGrandTotal, setShowGrandTotal] = useState(true);

  // グラフの高さ (カード右下のハンドルをドラッグして調整・ブラウザに保存)
  const CHART_HEIGHT_KEY = 'report_chart_height';
  const CHART_MIN_H = 200;
  const CHART_MAX_H = 900;
  const [chartHeight, setChartHeight] = useState(320);
  useEffect(() => {
    const saved = Number(window.localStorage.getItem(CHART_HEIGHT_KEY));
    if (Number.isFinite(saved) && saved >= CHART_MIN_H) setChartHeight(saved);
  }, []);
  // 右下ハンドルのドラッグで高さを伸縮する
  const onChartResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = chartHeight;
    let latest = startH;
    const onMove = (ev: PointerEvent) => {
      latest = Math.min(CHART_MAX_H, Math.max(CHART_MIN_H, startH + (ev.clientY - startY)));
      setChartHeight(latest);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.localStorage.setItem(CHART_HEIGHT_KEY, String(latest));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const colById = useMemo(() => {
    const m = new Map<string, ReportColumnView>();
    for (const c of columns) m.set(c.id, c);
    return m;
  }, [columns]);

  const chartCatCol = chart ? colById.get(chart.categoryColumnId) : undefined;
  const chartCatAlias = chartCatCol?.alias;

  // ----- 選択カテゴリで絞り込んだ行 -----
  const filteredRows = useMemo(() => {
    if (!selected || !chartCatAlias) return rows;
    return rows.filter((r) => categoryName(r[chartCatAlias], chartCatCol?.dataType) === selected);
  }, [rows, selected, chartCatAlias, chartCatCol]);

  // ----- 昇順/降順ソートを適用した行(テーブル・グラフ共通) -----
  const sortedRows = useMemo(() => {
    if (!sort) return filteredRows;
    const col = colById.get(sort.colId);
    if (!col) return filteredRows;
    const arr = [...filteredRows];
    arr.sort((a, b) => {
      const cmp = compareValues(a[col.alias], b[col.alias], col.dataType);
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filteredRows, sort, colById]);

  // ----- グラフ用データ。ソート時は行の並び順を保持(グラフも昇順/降順に連動) -----
  const chartData = useMemo(
    () =>
      chart ? computeChartData(sortedRows, columns, chart, sort ? 'preserve' : 'value_desc') : null,
    [chart, sortedRows, columns, sort],
  );

  // ----- サマリー指標(小計 / 総計 / ヘッダーで使う) -----
  const summaries = display?.summaries ?? [];
  const aggByColId = useMemo(() => {
    const m = new Map<string, (typeof summaries)[number]['aggregate']>();
    for (const s of summaries) if (!m.has(s.columnId)) m.set(s.columnId, s.aggregate);
    return m;
  }, [summaries]);
  const hasSummary = aggByColId.size > 0;

  // ----- 表示グルーピング -----
  const groupCol = display?.groupByColumnId ? colById.get(display.groupByColumnId) : undefined;
  const groupColIndex = groupCol ? columns.findIndex((c) => c.id === groupCol.id) : -1;

  const groups = useMemo(() => {
    if (!groupCol) return null;
    const out: Array<{ key: string; rows: Array<Record<string, unknown>> }> = [];
    const idx = new Map<string, number>();
    for (const r of sortedRows) {
      // グループキーはテーブルと同じ整形値で作る(日時は同一日付でまとまる)
      const key = categoryName(r[groupCol.alias], groupCol.dataType);
      let i = idx.get(key);
      if (i === undefined) {
        i = out.length;
        idx.set(key, i);
        out.push({ key, rows: [] });
      }
      out[i]!.rows.push(r);
    }
    return out;
  }, [groupCol, sortedRows]);

  // ----- 小計/総計行: ラベルは labelColIndex(グループ列) に出す -----
  const renderSummaryRow = (
    groupRows: Array<Record<string, unknown>>,
    label: string,
    variant: 'subtotal' | 'grandtotal',
    labelColIndex: number,
  ) => (
    <TableRow
      className={variant === 'grandtotal' ? 'bg-slate-100 font-bold' : 'bg-slate-50 font-medium'}
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
    const text = formatCell(row[c.alias], c.dataType);
    const linkable = c.source === 'm.name' && memberId != null && text !== '';
    // 改行を含む値は元の改行を保持して表示(資産状況などの複数行テキスト)
    const multiline = text.includes('\n');
    return (
      <TableCell
        key={c.alias}
        className={
          multiline
            ? 'whitespace-pre-wrap align-top text-xs min-w-[16rem]'
            : 'whitespace-nowrap text-xs'
        }
      >
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
        <span className="ml-1 font-normal text-muted-foreground">({g.rows.length}件)</span>
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
          <span className="ml-2 font-normal text-muted-foreground">{g.rows.length}件</span>
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
            {/* 棒が多いときは最小幅を確保して横スクロール(円/ドーナツは除く) */}
            <div className="overflow-x-auto">
              <div
                style={
                  chart.type === 'pie' || chart.type === 'donut'
                    ? undefined
                    : { minWidth: `${Math.max(chartData.data.length * 40, 320)}px` }
                }
              >
                <ReportChart
                  type={chart.type}
                  chartData={chartData}
                  title={chart.title}
                  height={chartHeight}
                  onCategoryClick={
                    chartCatAlias
                      ? (name) => setSelected((cur) => (cur === name ? null : name))
                      : undefined
                  }
                  activeCategory={selected}
                />
              </div>
            </div>
            {/* リサイズハンドル: 下部のバーを上下にドラッグして高さを調整(ブラウザに保存) */}
            <div
              role="separator"
              aria-label="グラフの高さを調整"
              title="ドラッグで高さを調整"
              onPointerDown={onChartResizeStart}
              className="mt-2 flex h-6 cursor-ns-resize touch-none select-none items-center justify-center gap-2 rounded-md border border-dashed bg-muted/40 text-[11px] text-muted-foreground transition-colors hover:bg-muted"
            >
              <span className="h-1 w-8 rounded-full bg-muted-foreground/40" />
              ドラッグで高さ調整（{chartHeight}px）
              <span className="h-1 w-8 rounded-full bg-muted-foreground/40" />
            </div>
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
          <div className="max-h-[640px] overflow-auto" data-scroll-container>
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((c) => {
                    const active = sort?.colId === c.id;
                    const arrow = active ? (sort?.dir === 'asc' ? ' ▲' : ' ▼') : '';
                    return (
                      <TableHead key={c.alias} className="whitespace-nowrap text-xs">
                        <button
                          type="button"
                          onClick={() =>
                            setSort((cur) =>
                              cur?.colId !== c.id
                                ? { colId: c.id, dir: 'asc' }
                                : cur.dir === 'asc'
                                  ? { colId: c.id, dir: 'desc' }
                                  : null,
                            )
                          }
                          className="inline-flex items-center hover:text-primary"
                          title="クリックで昇順/降順"
                        >
                          {c.label}
                          <span className="text-primary">{arrow}</span>
                        </button>
                      </TableHead>
                    );
                  })}
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
                                  <TableCell key={c.alias} className="whitespace-nowrap text-xs">
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
                      renderSummaryRow(filteredRows, '総計', 'grandtotal', labelColIndex)}
                  </>
                ) : (
                  // フラット表示
                  <>
                    {sortedRows.map((row, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: 行に安定IDがないため index 使用
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
              <ToggleSwitch label="総計" checked={showGrandTotal} onChange={setShowGrandTotal} />
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
  renderDetailCell: (row: Record<string, unknown>, c: ReportColumnView) => React.ReactNode;
  renderSummaryRow: (rows: Array<Record<string, unknown>>, label: string) => React.ReactNode;
  groupMergedCell: (g: { key: string; rows: unknown[] }, key: string) => React.ReactNode;
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
        <TableRow key={i} className={i === 0 ? 'border-t-2 border-slate-300' : undefined}>
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
