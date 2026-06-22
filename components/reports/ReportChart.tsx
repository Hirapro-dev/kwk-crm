'use client';

/**
 * レポートのグラフ表示(仕様書 §9.6 / §9.15)
 *
 * Salesforce レポートのグラフを模した表示:
 *   - 縦棒 / 横棒 / 円 / ドーナツ / 折れ線
 *   - データは computeChartData() で集計済みの {name, value}[] を受け取る
 *   - onCategoryClick を渡すと棒/スライスをクリックでカテゴリ絞り込みが可能
 *
 * Recharts は Client Component 必須のため 'use client'。
 * Tooltip の formatter は recharts v3 の型と相性が悪いため使わず、
 * Bar/Line の name と軸 tickFormatter で表現する。
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ChartData } from '@/lib/reports/chart_data';
import type { ChartType } from '@/lib/reports/types';

const PALETTE = [
  '#1589ee',
  '#9333ea',
  '#16a34a',
  '#f59e0b',
  '#ef4444',
  '#0ea5e9',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#64748b',
  '#84cc16',
];
const BAR_COLOR = '#1589ee';

const compact = new Intl.NumberFormat('ja-JP', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** recharts のクリックイベント引数からカテゴリ名を取り出す */
function extractName(arg: unknown): string | null {
  if (arg && typeof arg === 'object') {
    const o = arg as { name?: unknown; payload?: { name?: unknown } };
    if (typeof o.name === 'string') return o.name;
    if (o.payload && typeof o.payload.name === 'string') return o.payload.name;
  }
  return null;
}

interface Props {
  type: ChartType;
  chartData: ChartData;
  title?: string;
  height?: number;
  /** 棒/スライスのクリックでカテゴリ名を通知(絞り込み用) */
  onCategoryClick?: (name: string) => void;
  /** 絞り込み中のカテゴリ(該当以外を淡色化) */
  activeCategory?: string | null;
}

export function ReportChart({
  type,
  chartData,
  title,
  height = 320,
  onCategoryClick,
  activeCategory,
}: Props) {
  const { data, valueLabel } = chartData;

  if (data.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
        グラフに表示するデータがありません
      </div>
    );
  }

  const innerHeight = title ? height - 24 : height;
  const clickable = typeof onCategoryClick === 'function';
  const handleClick = (arg: unknown) => {
    if (!clickable) return;
    const name = extractName(arg);
    if (name !== null) onCategoryClick(name);
  };
  /** 強調表示: 絞り込み中は該当カテゴリのみ濃色、他は淡色 */
  const fillFor = (name: string, base: string) =>
    activeCategory && name !== activeCategory ? `${base}55` : base;

  const cursor = clickable ? 'pointer' : 'default';

  const renderChart = () => {
    const tooltipStyle = {
      fontSize: 12,
      borderRadius: 4,
      border: '1px solid #e5e7eb',
    };

    switch (type) {
      case 'bar_horizontal':
        return (
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
          >
            <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 11, fill: '#475569' }}
              tickFormatter={(v: number) => compact.format(v)}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 11, fill: '#475569' }}
              width={140}
              interval={0}
            />
            <Tooltip cursor={{ fill: 'rgba(21,137,238,0.08)' }} contentStyle={tooltipStyle} />
            <Bar
              dataKey="value"
              name={valueLabel}
              radius={[0, 4, 4, 0]}
              maxBarSize={32}
              onClick={handleClick}
              style={{ cursor }}
            >
              {data.map((d) => (
                <Cell key={d.name} fill={fillFor(d.name, BAR_COLOR)} />
              ))}
            </Bar>
          </BarChart>
        );

      case 'pie':
      case 'donut':
        return (
          <PieChart>
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius="80%"
              innerRadius={type === 'donut' ? '50%' : 0}
              label={(entry: { name?: string }) => entry.name ?? ''}
              labelLine={false}
              onClick={handleClick}
              style={{ cursor }}
            >
              {data.map((d, i) => (
                <Cell
                  key={d.name}
                  fill={fillFor(d.name, PALETTE[i % PALETTE.length] as string)}
                />
              ))}
            </Pie>
          </PieChart>
        );

      case 'line':
        return (
          <LineChart data={data} margin={{ top: 8, right: 24, left: 8, bottom: 48 }}>
            <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11, fill: '#475569' }}
              interval={0}
              angle={-30}
              textAnchor="end"
              height={60}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#475569' }}
              tickFormatter={(v: number) => compact.format(v)}
              width={64}
            />
            <Tooltip contentStyle={tooltipStyle} />
            <Line
              type="monotone"
              dataKey="value"
              name={valueLabel}
              stroke={BAR_COLOR}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{
                r: 5,
                onClick: (_e: unknown, payload: unknown) => handleClick(payload),
              }}
            />
          </LineChart>
        );
      default:
        // bar_vertical(既定)
        return (
          <BarChart data={data} margin={{ top: 8, right: 24, left: 8, bottom: 48 }}>
            <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11, fill: '#475569' }}
              interval={0}
              angle={-30}
              textAnchor="end"
              height={60}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#475569' }}
              tickFormatter={(v: number) => compact.format(v)}
              width={64}
            />
            <Tooltip cursor={{ fill: 'rgba(21,137,238,0.08)' }} contentStyle={tooltipStyle} />
            <Bar
              dataKey="value"
              name={valueLabel}
              radius={[4, 4, 0, 0]}
              maxBarSize={56}
              onClick={handleClick}
              style={{ cursor }}
            >
              {data.map((d) => (
                <Cell key={d.name} fill={fillFor(d.name, BAR_COLOR)} />
              ))}
            </Bar>
          </BarChart>
        );
    }
  };

  return (
    <div className="w-full" style={{ height }}>
      {title && (
        <p className="mb-1 text-center text-sm font-semibold text-slate-800">
          {title}
        </p>
      )}
      <ResponsiveContainer width="100%" height={innerHeight}>
        {renderChart()}
      </ResponsiveContainer>
    </div>
  );
}
