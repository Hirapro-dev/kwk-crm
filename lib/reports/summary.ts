/**
 * サマリー指標 / 小計・総計の集計(仕様書 §9.6)
 *
 * 取得済みの結果行に対して、指定列を指定の集計関数で計算する純粋関数。
 * グラフ同様、追加 SQL は発行しない(SQL Builder 非干渉)。
 */

import { parseNumericCell } from './chart_data';
import type { SummaryAggregate } from './types';

export const SUMMARY_AGG_LABEL: Record<SummaryAggregate, string> = {
  sum: '合計',
  avg: '平均',
  count: '件数',
  count_distinct: 'ユニーク',
  min: '最小',
  max: '最大',
};

const intFmt = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 });
const decFmt = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 });

/**
 * 1 つの列・集計関数に対する値を計算する。
 * - count: 行数(alias 不要)
 * - count_distinct: 非空のユニーク数
 * - sum/avg/min/max: 数値化できた値のみで計算
 */
export function aggregateColumn(
  rows: Array<Record<string, unknown>>,
  alias: string | undefined,
  agg: SummaryAggregate,
): number {
  if (agg === 'count') return rows.length;

  if (agg === 'count_distinct') {
    const set = new Set<string>();
    for (const r of rows) {
      const v = alias ? r[alias] : undefined;
      if (v !== null && v !== undefined && v !== '') set.add(String(v));
    }
    return set.size;
  }

  const nums: number[] = [];
  for (const r of rows) {
    const n = parseNumericCell(alias ? r[alias] : undefined);
    if (n !== null) nums.push(n);
  }
  if (nums.length === 0) return 0;
  switch (agg) {
    case 'sum':
      return nums.reduce((a, b) => a + b, 0);
    case 'avg':
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'min':
      return Math.min(...nums);
    case 'max':
      return Math.max(...nums);
    default:
      return 0;
  }
}

/** 集計値の表示整形(件数・ユニークは整数、平均等は小数2桁まで) */
export function formatSummaryValue(value: number, agg: SummaryAggregate): string {
  if (agg === 'count' || agg === 'count_distinct') return intFmt.format(value);
  if (agg === 'avg') return decFmt.format(value);
  return intFmt.format(Math.round(value));
}
