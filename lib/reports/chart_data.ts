/**
 * グラフ用データ集計(仕様書 §9.6)
 *
 * レポートの結果行(表示済みの最大 row_limit 件)をカテゴリ列でグルーピングし、
 * 値列を指定の集計方法でまとめてグラフ用の {name, value}[] を返す純粋関数。
 *
 * 設計判断:
 *   - 追加 SQL は発行せず、取得済みの結果行をクライアント/サーバーどちらでも集計できる
 *     純粋関数として実装(SQL Builder のセキュリティ機構に触れない最小構成)。
 *   - 集計済みレポート(RT02/RT08/RT10)は 1 カテゴリ=1 行になりやすく、その場合でも
 *     sum/max 等は値そのものになるため破綻しない。
 */

import type { ChartAggregate, ReportChartConfig } from './types';

export interface ChartColumnRef {
  id: string;
  alias: string;
  label: string;
}

export interface ChartDatum {
  name: string;
  value: number;
}

export interface ChartData {
  data: ChartDatum[];
  categoryLabel: string;
  valueLabel: string;
}

const AGG_LABEL: Record<ChartAggregate, string> = {
  sum: '合計',
  avg: '平均',
  count: '件数',
  min: '最小',
  max: '最大',
};

/** 文字列/数値セルを数値化。カンマ・通貨記号を除去。数値化できなければ null */
export function parseNumericCell(v: unknown): number | null {
  return toNumber(v);
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[,¥\s]/g, '');
    if (cleaned === '') return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * 結果行 + 列情報 + グラフ設定 → グラフ用データ。
 * カテゴリ列が見つからない等で集計できない場合は null。
 */
export function computeChartData(
  rows: Array<Record<string, unknown>>,
  columns: ChartColumnRef[],
  chart: ReportChartConfig,
): ChartData | null {
  const catCol = columns.find((c) => c.id === chart.categoryColumnId);
  if (!catCol) return null;

  const valCol = chart.valueColumnId
    ? columns.find((c) => c.id === chart.valueColumnId)
    : undefined;
  // 値列が無い場合は件数集計に強制
  const agg: ChartAggregate = valCol ? chart.valueAggregate : 'count';

  interface Acc {
    sum: number;
    count: number;
    min: number;
    max: number;
    numCount: number;
  }
  const groups = new Map<string, Acc>();
  // 挿入順を保持(同値時の安定表示用)
  const order: string[] = [];

  for (const row of rows) {
    const raw = row[catCol.alias];
    const name =
      raw === null || raw === undefined || raw === ''
        ? '(空白)'
        : String(raw);
    let acc = groups.get(name);
    if (!acc) {
      acc = {
        sum: 0,
        count: 0,
        min: Number.POSITIVE_INFINITY,
        max: Number.NEGATIVE_INFINITY,
        numCount: 0,
      };
      groups.set(name, acc);
      order.push(name);
    }
    acc.count += 1;
    if (valCol) {
      const n = toNumber(row[valCol.alias]);
      if (n !== null) {
        acc.sum += n;
        acc.min = Math.min(acc.min, n);
        acc.max = Math.max(acc.max, n);
        acc.numCount += 1;
      }
    }
  }

  const data: ChartDatum[] = order.map((name) => {
    const a = groups.get(name) as Acc;
    let value: number;
    switch (agg) {
      case 'count':
        value = a.count;
        break;
      case 'sum':
        value = a.sum;
        break;
      case 'avg':
        value = a.numCount > 0 ? a.sum / a.numCount : 0;
        break;
      case 'min':
        value = a.numCount > 0 ? a.min : 0;
        break;
      case 'max':
        value = a.numCount > 0 ? a.max : 0;
        break;
      default:
        value = a.count;
    }
    return { name, value };
  });

  // 値の降順で並べる(Salesforce のグラフ既定に近い見え方)
  data.sort((x, y) => y.value - x.value);

  const valueLabel =
    agg === 'count' || !valCol
      ? 'レコード件数'
      : `${AGG_LABEL[agg]}: ${valCol.label}`;

  return { data, categoryLabel: catCol.label, valueLabel };
}
