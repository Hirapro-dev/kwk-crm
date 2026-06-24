'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * sales ユーザー別 入金額の棒グラフ。
 *
 * - 横軸: ユーザー名 (sales ロールの担当者)
 * - 縦軸: 入金額 (¥)
 * - データはサーバー側で集計済みの summary.rows をそのまま受け取る
 * - 入金額 0 のユーザーも棒として表示する (テーブル側と同じ振る舞い)
 *
 * Recharts は Client Component が必須のため、'use client' で切り出した。
 */

interface Datum {
  user_name: string;
  total_payment_amount: number;
  payment_count: number;
}

interface Props {
  rows: Datum[];
}

const yenFormatter = new Intl.NumberFormat('ja-JP', {
  style: 'currency',
  currency: 'JPY',
  maximumFractionDigits: 0,
});

const yenCompact = new Intl.NumberFormat('ja-JP', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function SalesBarChart({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
        表示するデータがありません
      </div>
    );
  }

  return (
    <div className="h-[320px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          margin={{ top: 16, right: 24, left: 8, bottom: 48 }}
        >
          <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="user_name"
            tick={{ fontSize: 11, fill: '#475569' }}
            interval={0}
            angle={-30}
            textAnchor="end"
            height={60}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#475569' }}
            tickFormatter={(v: number) => yenCompact.format(v)}
            width={70}
          />
          <Tooltip
            formatter={(value) => [
              yenFormatter.format(Number(value)),
              '入金額',
            ]}
            labelFormatter={(label) => `担当者: ${String(label)}`}
            cursor={{ fill: 'rgba(21, 137, 238, 0.08)' }}
            contentStyle={{
              fontSize: 12,
              borderRadius: 4,
              border: '1px solid #e5e7eb',
            }}
          />
          <Bar
            dataKey="total_payment_amount"
            fill="#00C896"
            radius={[4, 4, 0, 0]}
            maxBarSize={48}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
