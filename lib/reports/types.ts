/**
 * 仕様書 §9.3 レポートタイプ定義 (RT01-RT10)
 *
 * このファイルはレポートタイプのメタデータを TypeScript の型と定数として保持する。
 * 実際の SQL 生成は lib/reports/builder.ts が、ホワイトリスト方式で安全に行う。
 */

export type ReportTypeId =
  | 'RT01'
  | 'RT02'
  | 'RT03'
  | 'RT04'
  | 'RT05'
  | 'RT06'
  | 'RT07'
  | 'RT08'
  | 'RT09'
  | 'RT10';

export interface ReportTypeMeta {
  id: ReportTypeId;
  name: string;
  baseTable: string; // 主軸テーブル
  description: string;
  unit: string; // 出力単位
}

/**
 * 仕様書 §9.3 表に対応。
 * 詳細なカラム/結合定義は別途 lib/reports/schema.ts で管理(Phase 6 で実装)。
 */
export const REPORT_TYPES: Record<ReportTypeId, ReportTypeMeta> = {
  RT01: {
    id: 'RT01',
    name: '会員一覧',
    baseTable: 'members',
    description: '会員と担当者の一覧',
    unit: '1会員=1行',
  },
  RT02: {
    id: 'RT02',
    name: '会員サマリ',
    baseTable: 'members',
    description: '会員ごとの申込件数・総入金額・最終対応日・対応件数を1行に集計',
    unit: '1会員=1行(集計済)',
  },
  RT03: {
    id: 'RT03',
    name: '会員と申込',
    baseTable: 'members_applications',
    description: '会員と申込の結合一覧',
    unit: '1申込=1行',
  },
  RT04: {
    id: 'RT04',
    name: '会員と対応歴',
    baseTable: 'members_activities',
    description: '会員と対応歴の結合一覧',
    unit: '1対応=1行',
  },
  RT05: {
    id: 'RT05',
    name: '会員と問合せ',
    baseTable: 'members_inquiries',
    description: '会員と問合せ・フォーム種別の結合一覧',
    unit: '1問合せ=1行',
  },
  RT06: {
    id: 'RT06',
    name: '申込一覧',
    baseTable: 'applications',
    description: '申込と関連オブジェクトの結合一覧',
    unit: '1申込=1行',
  },
  RT07: {
    id: 'RT07',
    name: '対応歴一覧',
    baseTable: 'activities',
    description: '対応歴とその会員・担当者の結合一覧',
    unit: '1対応=1行',
  },
  RT08: {
    id: 'RT08',
    name: '対応歴マトリクス',
    baseTable: 'activities',
    description: '担当×期間×分類のクロス集計',
    unit: '担当者×期間×分類',
  },
  RT09: {
    id: 'RT09',
    name: '問合せ一覧',
    baseTable: 'inquiries',
    description: '問合せ一覧(フォーム種別・会員紐付け含む)',
    unit: '1問合せ=1行',
  },
  RT10: {
    id: 'RT10',
    name: '案件別実績',
    baseTable: 'applications',
    description: '案件ごとの申込数・合計入金額の集計',
    unit: '1案件=1行(集計済)',
  },
};

/**
 * 仕様書 §9.5.1: フィルタ演算子(データ型別)
 */
export type FilterOperator =
  // text
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'in'
  | 'not_in'
  // number
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  // date
  | 'before'
  | 'after'
  | 'this_week'
  | 'this_month'
  | 'this_year'
  | 'last_n_days'
  | 'next_n_days'
  // boolean
  | 'is_true'
  | 'is_false'
  // jsonb
  | 'key_exists'
  | 'key_equals'
  | 'key_contains'
  // common
  | 'is_null'
  | 'is_not_null';

export type AggregateFunction = 'sum' | 'avg' | 'count' | 'count_distinct' | 'min' | 'max';

export interface ReportColumn {
  id: string;
  source: string; // 例: 'members.name', 'applications.payment_amount'
  label: string;
  aggregate?: AggregateFunction;
  join_alias?: string;
}

export interface ReportFilterCondition {
  field: string;
  op: FilterOperator;
  value?: unknown;
  values?: unknown[]; // in / between 用
}

export interface ReportFilterGroup {
  logic: 'AND' | 'OR';
  conditions: Array<ReportFilterCondition | { group: ReportFilterGroup }>;
}

/**
 * 仕様書 §9.6 / §9.15: グラフ表示(Salesforce レポートのグラフ相当)
 * レポート結果リストの上部に表示するグラフの設定。
 */
export type ChartType =
  | 'bar_vertical' // 縦棒
  | 'bar_horizontal' // 横棒
  | 'pie' // 円
  | 'donut' // ドーナツ
  | 'line'; // 折れ線

/** グラフの値に使う集計方法。'count' は値カラム不要(レコード件数) */
export type ChartAggregate = 'sum' | 'avg' | 'count' | 'min' | 'max';

export interface ReportChartConfig {
  type: ChartType;
  /** カテゴリ軸(X軸 / スライス)に使う列。definition.columns[].id を参照 */
  categoryColumnId: string;
  /** 値(Y軸 / 大きさ)に使う列の id。'count'(件数)の場合は未指定可 */
  valueColumnId?: string;
  /** 同一カテゴリの行をまとめる集計方法 */
  valueAggregate: ChartAggregate;
  /** グラフタイトル(任意) */
  title?: string;
}

/**
 * 仕様書 §9.6: 表示グルーピング / サマリー指標(Salesforce サマリーレポート相当)
 *
 * 注: definition.group_by は SQL レベルの集計(行を畳む)。
 *     こちらの display は SQL は変えず、取得済みの結果行を「表示上」グループ化し、
 *     小計・総計・サマリー指標を計算するための設定。
 */
export type SummaryAggregate =
  | 'sum'
  | 'avg'
  | 'count'
  | 'count_distinct'
  | 'min'
  | 'max';

export interface ReportSummaryField {
  /** 集計対象の列。definition.columns[].id を参照 */
  columnId: string;
  aggregate: SummaryAggregate;
}

export interface ReportDisplayConfig {
  /** 表示グルーピングに使う列(1レベル)。definition.columns[].id を参照 */
  groupByColumnId?: string;
  /** サマリー指標(ヘッダー表示 + グループ小計 + 総計に使う) */
  summaries?: ReportSummaryField[];
}

export interface ReportDefinition {
  columns: ReportColumn[];
  filters?: ReportFilterGroup;
  group_by?: Array<{ field: string; level: 1 | 2 | 3 }>;
  sort?: Array<{ field: string; direction: 'asc' | 'desc' }>;
  having?: Array<ReportFilterCondition & { aggregate?: AggregateFunction }>;
  row_limit?: number;
  /** グラフ設定(結果リスト上部に表示)。未設定ならグラフ非表示 */
  chart?: ReportChartConfig;
  /** 表示グルーピング / サマリー指標 */
  display?: ReportDisplayConfig;
}
