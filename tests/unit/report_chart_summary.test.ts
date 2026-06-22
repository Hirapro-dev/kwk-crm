import { describe, expect, it } from 'vitest';
import { computeChartData } from '../../lib/reports/chart_data';
import {
  aggregateColumn,
  formatSummaryValue,
} from '../../lib/reports/summary';
import type { ReportChartConfig } from '../../lib/reports/types';

/**
 * グラフ集計 / サマリー指標 / 小計・総計の中核ロジック検証(仕様書 §9.6)
 *
 * 意図:
 *   - #3 小計/総計、#4 サマリー指標は aggregateColumn に依存するため、
 *     集計関数ごとの「意図した値」を境界含めて検証する。
 *   - グラフ(#1 のクリック絞り込み対象)のカテゴリ集計 computeChartData も検証。
 */

const COLUMNS = [
  { id: 'c1', alias: 'cat', label: '区分' },
  { id: 'c2', alias: 'amount', label: '金額' },
];

const ROWS = [
  { cat: 'A', amount: 100 },
  { cat: 'A', amount: 200 },
  { cat: 'B', amount: 50 },
];

describe('computeChartData(グラフ集計)', () => {
  it('カテゴリ別に合計し、値の降順で並ぶ', () => {
    const chart: ReportChartConfig = {
      type: 'bar_vertical',
      categoryColumnId: 'c1',
      valueColumnId: 'c2',
      valueAggregate: 'sum',
    };
    const res = computeChartData(ROWS, COLUMNS, chart);
    expect(res).not.toBeNull();
    expect(res?.data).toEqual([
      { name: 'A', value: 300 },
      { name: 'B', value: 50 },
    ]);
    expect(res?.valueLabel).toBe('合計: 金額');
    expect(res?.categoryLabel).toBe('区分');
  });

  it('件数集計は値列に依存せず行数を数える', () => {
    const chart: ReportChartConfig = {
      type: 'pie',
      categoryColumnId: 'c1',
      valueAggregate: 'count',
    };
    const res = computeChartData(ROWS, COLUMNS, chart);
    expect(res?.data).toEqual([
      { name: 'A', value: 2 },
      { name: 'B', value: 1 },
    ]);
    expect(res?.valueLabel).toBe('レコード件数');
  });

  it('平均集計は数値化できた値のみで計算する', () => {
    const chart: ReportChartConfig = {
      type: 'bar_vertical',
      categoryColumnId: 'c1',
      valueColumnId: 'c2',
      valueAggregate: 'avg',
    };
    const res = computeChartData(ROWS, COLUMNS, chart);
    // A: (100+200)/2 = 150, B: 50
    expect(res?.data).toEqual([
      { name: 'A', value: 150 },
      { name: 'B', value: 50 },
    ]);
  });

  it('カテゴリが空/NULL は「(空白)」にまとめ、カンマ付き数値文字列も集計できる', () => {
    const rows = [
      { cat: null, amount: '1,000' },
      { cat: '', amount: '2,000' },
      { cat: 'X', amount: '500' },
    ];
    const chart: ReportChartConfig = {
      type: 'bar_vertical',
      categoryColumnId: 'c1',
      valueColumnId: 'c2',
      valueAggregate: 'sum',
    };
    const res = computeChartData(rows, COLUMNS, chart);
    // null と '' は同じ「(空白)」グループ → 1000+2000=3000
    expect(res?.data).toEqual([
      { name: '(空白)', value: 3000 },
      { name: 'X', value: 500 },
    ]);
  });

  it('カテゴリ列が存在しなければ null', () => {
    const chart: ReportChartConfig = {
      type: 'bar_vertical',
      categoryColumnId: 'missing',
      valueAggregate: 'count',
    };
    expect(computeChartData(ROWS, COLUMNS, chart)).toBeNull();
  });
});

describe('aggregateColumn(小計/総計・サマリー指標)', () => {
  const rows = [
    { v: '10' },
    { v: '20' },
    { v: null },
    { v: 'x' },
  ];

  it('sum / avg / min / max は数値化できた値のみ対象', () => {
    expect(aggregateColumn(rows, 'v', 'sum')).toBe(30);
    expect(aggregateColumn(rows, 'v', 'avg')).toBe(15); // (10+20)/2
    expect(aggregateColumn(rows, 'v', 'min')).toBe(10);
    expect(aggregateColumn(rows, 'v', 'max')).toBe(20);
  });

  it('count は行数、count_distinct は非空のユニーク数(非数値も種類として数える)', () => {
    expect(aggregateColumn(rows, 'v', 'count')).toBe(4);
    // '10' '20' 'x' の3種類(null は除外)
    expect(aggregateColumn(rows, 'v', 'count_distinct')).toBe(3);
  });

  it('数値が無ければ sum/avg/min/max は 0', () => {
    const empty = [{ v: null }, { v: '' }];
    expect(aggregateColumn(empty, 'v', 'sum')).toBe(0);
    expect(aggregateColumn(empty, 'v', 'avg')).toBe(0);
    expect(aggregateColumn(empty, 'v', 'min')).toBe(0);
    expect(aggregateColumn(empty, 'v', 'max')).toBe(0);
  });
});

describe('formatSummaryValue(表示整形)', () => {
  it('件数・ユニークは整数、平均は小数2桁まで、合計は四捨五入', () => {
    expect(formatSummaryValue(1234, 'count')).toBe('1,234');
    expect(formatSummaryValue(12, 'count_distinct')).toBe('12');
    expect(formatSummaryValue(1234.5, 'avg')).toBe('1,234.5');
    expect(formatSummaryValue(1234.6, 'sum')).toBe('1,235');
  });
});
