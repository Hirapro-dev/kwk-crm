/**
 * 安全な SQL Builder(仕様書 §9.8)
 *
 * Phase 0 で雛形のみ作った builder.ts は編集禁止のため、本 builder_v2.ts に本実装する。
 *
 * 厳守事項:
 *   1. ホワイトリスト方式: REPORT_SCHEMAS に存在するカラム・結合・テーブルのみ使用
 *   2. 値は必ずパラメータ化($1, $2, ...): supabase.rpc 経由で実行する想定
 *   3. 識別子の正規表現チェック: isSafeIdentifier()
 *   4. クエリタイムアウト: 30秒
 *   5. デフォルト LIMIT 10,000(Excel 出力時は 50,000)
 */

import {
  type AllowedColumnDef,
  REPORT_SCHEMAS,
  expandExtraSource,
  findColumn,
  isSafeIdentifier,
} from './schema_all';
import type {
  AggregateFunction,
  FilterOperator,
  ReportColumn,
  ReportDefinition,
  ReportFilterCondition,
  ReportFilterGroup,
  ReportTypeId,
} from './types';

export interface BuiltQuery {
  sql: string;
  params: unknown[];
  /** 出力列のエイリアス順(SELECT に対応)。CSV/Excel 出力で使う */
  columns: Array<{ id: string; label: string; alias: string; source: string; dataType: string }>;
}

/** 会員氏名カラムのソース・会員ID(リンク用隠しカラム)の定義 */
const MEMBER_NAME_SOURCE = 'm.name';
const MEMBER_ID_SOURCE = 'm.id';
/** 結果行に付与する会員IDの隠しエイリアス(出力カラムには含めない) */
export const MEMBER_LINK_ID_ALIAS = 'm_link_id';

export const DEFAULT_ROW_LIMIT = 10_000;
export const MAX_EXCEL_ROW_LIMIT = 50_000;

/**
 * 明示的な sort が未指定のときに適用する「既定の並び順」列(レポートタイプ別)。
 * オブジェクト一覧と同様に「日付が最新のものを上から」表示するため、
 * 各レポートタイプの主軸日付列を降順(DESC NULLS LAST)で並べる。
 *
 * 集計レポート(RT02 会員サマリ / RT08 マトリクス / RT10 案件別実績)は
 * 行を畳むため日付列での並び替えが GROUP BY と不整合になる。よって既定ソートは持たない
 * (実際の適用は「GROUP BY / 集計列が無い行レベル出力のとき」に限定する)。
 * ソース文字列は各レポートタイプの baseAlias に対応(schema_all.ts 参照)。
 */
const DEFAULT_SORT_SOURCE: Partial<Record<ReportTypeId, string>> = {
  RT01: 'm.registered_at', // 会員一覧
  RT03: 'a.application_date', // 会員と申込
  RT04: 'act.registered_datetime', // 会員と対応歴
  RT05: 'inq.registered_at', // 会員と問合せ
  RT06: 'a.application_date', // 申込一覧
  RT07: 'act.registered_datetime', // 対応歴一覧
  RT09: 'inq.registered_at', // 問合せ一覧
};

const AGG_SQL: Record<AggregateFunction, (col: string) => string> = {
  sum: (c) => `SUM(${c})`,
  avg: (c) => `AVG(${c})`,
  count: (c) => `COUNT(${c})`,
  count_distinct: (c) => `COUNT(DISTINCT ${c})`,
  min: (c) => `MIN(${c})`,
  max: (c) => `MAX(${c})`,
};

/**
 * 出力列のエイリアスを生成。
 *   通常: 'm.name'                       → 'm_name'
 *   extra: 'm.extra:investing_amount'   → 'm_extra_investing_amount'
 *
 * 集計関数があれば 'sum_apps_payment_amount' のように prefix。
 * 日本語キーや特殊文字は SQL alias で使えないため、英数字とアンダースコア以外の
 * 文字を全て '_' に置換する(衝突可能性は alias の hash 補助を将来検討)。
 */
function aliasFor(col: ReportColumn): string {
  const base = col.source
    .replace(/\./g, '_')
    .replace(/:/g, '_')
    // SQL の識別子で許可される [a-zA-Z0-9_] 以外を _ にする
    .replace(/[^a-zA-Z0-9_]/g, '_');
  return col.aggregate ? `${col.aggregate}_${base}` : base;
}

/**
 * source 文字列を SQL 内で参照する形に展開する。
 *   通常: 'm.name' → 'm.name'
 *   extra: 'm.extra:foo' → "m.extra->>'foo'"
 */
function sourceSql(source: string): string {
  return expandExtraSource(source);
}

class ParamBag {
  private params: unknown[] = [];
  push(v: unknown): string {
    this.params.push(v);
    return `$${this.params.length}`;
  }
  toArray(): unknown[] {
    return this.params;
  }
}

/**
 * フィルタ演算子をパラメータ化された SQL 片に変換。
 * 値はすべて ParamBag を通してプレースホルダ化する。
 */
function operatorToSql(
  colSql: string,
  cond: ReportFilterCondition,
  pb: ParamBag,
  colDef: AllowedColumnDef,
  currentUserId: string,
): string {
  const op: FilterOperator = cond.op;
  const value = cond.value === '${current_user}' ? currentUserId : cond.value;

  switch (op) {
    case 'equals':
      return `${colSql} = ${pb.push(value)}`;
    case 'not_equals':
      return `${colSql} <> ${pb.push(value)}`;
    case 'contains':
      return `${colSql} ILIKE ${pb.push(`%${escapeLike(String(value ?? ''))}%`)}`;
    case 'not_contains':
      return `${colSql} NOT ILIKE ${pb.push(`%${escapeLike(String(value ?? ''))}%`)}`;
    case 'starts_with':
      return `${colSql} ILIKE ${pb.push(`${escapeLike(String(value ?? ''))}%`)}`;
    case 'ends_with':
      return `${colSql} ILIKE ${pb.push(`%${escapeLike(String(value ?? ''))}`)}`;
    case 'in': {
      const vs = cond.values ?? [];
      if (vs.length === 0) return '1 = 0';
      const phs = vs.map((v) => pb.push(v));
      return `${colSql} IN (${phs.join(', ')})`;
    }
    case 'not_in': {
      const vs = cond.values ?? [];
      if (vs.length === 0) return '1 = 1';
      const phs = vs.map((v) => pb.push(v));
      return `${colSql} NOT IN (${phs.join(', ')})`;
    }
    case 'gt':
      return `${colSql} > ${pb.push(value)}`;
    case 'gte':
      return `${colSql} >= ${pb.push(value)}`;
    case 'lt':
      return `${colSql} < ${pb.push(value)}`;
    case 'lte':
      return `${colSql} <= ${pb.push(value)}`;
    case 'between': {
      const vs = cond.values ?? [];
      if (vs.length !== 2) return '1 = 0';
      return `${colSql} BETWEEN ${pb.push(vs[0])} AND ${pb.push(vs[1])}`;
    }
    case 'before':
      return `${colSql} < ${pb.push(value)}`;
    case 'after':
      return `${colSql} > ${pb.push(value)}`;
    case 'this_week':
      return `${colSql} >= date_trunc('week', now()) AND ${colSql} < date_trunc('week', now()) + interval '7 days'`;
    case 'this_month':
      return `${colSql} >= date_trunc('month', now()) AND ${colSql} < date_trunc('month', now()) + interval '1 month'`;
    case 'this_year':
      return `${colSql} >= date_trunc('year', now()) AND ${colSql} < date_trunc('year', now()) + interval '1 year'`;
    case 'last_n_days': {
      const n = Number(value ?? 0);
      if (!Number.isFinite(n) || n < 0 || n > 3650) return '1 = 0';
      return `${colSql} >= (now() - interval '${Math.floor(n)} days')`;
    }
    case 'next_n_days': {
      const n = Number(value ?? 0);
      if (!Number.isFinite(n) || n < 0 || n > 3650) return '1 = 0';
      return `${colSql} <= (now() + interval '${Math.floor(n)} days') AND ${colSql} >= now()`;
    }
    case 'is_null':
      return `${colSql} IS NULL`;
    case 'is_not_null':
      return `${colSql} IS NOT NULL`;
    case 'is_true':
      return `${colSql} = true`;
    case 'is_false':
      return `${colSql} = false`;
    case 'key_exists': {
      if (colDef.dataType !== 'jsonb') throw new BuilderError('key_exists は jsonb 列のみ');
      return `${colSql} ? ${pb.push(String(value ?? ''))}`;
    }
    case 'key_equals': {
      if (colDef.dataType !== 'jsonb') throw new BuilderError('key_equals は jsonb 列のみ');
      const vs = cond.values ?? [];
      if (vs.length !== 2) throw new BuilderError('key_equals は values=[key,value] が必須');
      return `${colSql} ->> ${pb.push(vs[0])} = ${pb.push(vs[1])}`;
    }
    case 'key_contains': {
      if (colDef.dataType !== 'jsonb') throw new BuilderError('key_contains は jsonb 列のみ');
      const vs = cond.values ?? [];
      if (vs.length !== 2) throw new BuilderError('key_contains は values=[key,value] が必須');
      return `${colSql} ->> ${pb.push(vs[0])} ILIKE ${pb.push(`%${escapeLike(String(vs[1]))}%`)}`;
    }
    default:
      throw new BuilderError(`未対応の演算子: ${op}`);
  }
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export class BuilderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuilderError';
  }
}

/**
 * ホワイトリスト確認 + 識別子検証。
 * 不正があれば BuilderError を投げる。
 *
 * extraColumns が渡された場合、静的 schema に存在しなくても
 * 動的 extra カラムに含まれていれば許可する。
 */
function validateColumn(
  reportType: ReportTypeId,
  source: string,
  extraColumns: readonly AllowedColumnDef[] = [],
): AllowedColumnDef {
  if (!isSafeIdentifier(source)) {
    throw new BuilderError(`不正な識別子: ${source}`);
  }
  // 静的 schema を先に検索
  const def = findColumn(reportType, source);
  if (def) return def;
  // 動的 extra カラムを検索
  const extra = extraColumns.find((c) => c.source === source);
  if (extra) return extra;
  throw new BuilderError(`許可されていないカラム: ${source}`);
}

/**
 * 使用しているエイリアスから必要な JOIN を抽出。
 */
function detectRequiredJoins(reportType: ReportTypeId, usedSources: string[]): string[] {
  const schema = REPORT_SCHEMAS[reportType];
  const usedAliases = new Set<string>();
  for (const s of usedSources) {
    const dotIdx = s.indexOf('.');
    if (dotIdx > 0) usedAliases.add(s.slice(0, dotIdx));
  }
  const required: string[] = [];
  for (const j of schema.allowedJoins) {
    if (usedAliases.has(j.alias)) {
      required.push(
        `${j.type === 'left' ? 'LEFT JOIN' : 'INNER JOIN'} public.${j.table} ${j.alias} ON ${j.on}`,
      );
    }
  }
  return required;
}

function buildFilterGroup(
  reportType: ReportTypeId,
  group: ReportFilterGroup,
  pb: ParamBag,
  currentUserId: string,
  extraColumns: readonly AllowedColumnDef[],
): string {
  const parts: string[] = [];
  for (const c of group.conditions) {
    if ('group' in c) {
      parts.push(`(${buildFilterGroup(reportType, c.group, pb, currentUserId, extraColumns)})`);
    } else {
      const colDef = validateColumn(reportType, c.field, extraColumns);
      // extra なら 'm.extra->>\'key\'' に展開、通常は 'm.name' のまま
      const colSql = sourceSql(c.field);
      parts.push(operatorToSql(colSql, c, pb, colDef, currentUserId));
    }
  }
  if (parts.length === 0) return '1 = 1';
  return parts.join(` ${group.logic} `);
}

/**
 * メインビルド関数。
 * @param reportType    レポートタイプ ID
 * @param definition    ユーザー定義の column / filter / group_by / sort / having / row_limit
 * @param currentUserId RLS 影響下で実行されるが、'${current_user}' プレースホルダ展開用に使う
 * @param extraColumns  主軸オブジェクトの extra jsonb キーから動的生成された AllowedColumnDef 群。
 *                      未指定の場合は静的 schema のみ許可される。
 */
export function buildReportQuery(
  reportType: ReportTypeId,
  definition: ReportDefinition,
  currentUserId: string,
  extraColumns: readonly AllowedColumnDef[] = [],
): BuiltQuery {
  const schema = REPORT_SCHEMAS[reportType];
  if (!schema) throw new BuilderError(`未知のレポートタイプ: ${reportType}`);
  if (!definition.columns || definition.columns.length === 0) {
    throw new BuilderError('1つ以上の列が必要です');
  }

  const pb = new ParamBag();
  const outputColumns: BuiltQuery['columns'] = [];
  const usedSources = new Set<string>();
  const selectParts: string[] = [];

  // SELECT 句
  for (const col of definition.columns) {
    const colDef = validateColumn(reportType, col.source, extraColumns);
    if (col.aggregate && !colDef.aggregatable) {
      throw new BuilderError(`集計不可: ${col.source}`);
    }
    const srcSql = sourceSql(col.source);
    const sql = col.aggregate ? AGG_SQL[col.aggregate](srcSql) : srcSql;
    const alias = aliasFor(col);
    if (!isSafeIdentifier(alias)) {
      throw new BuilderError(`不正なエイリアス: ${alias}`);
    }
    selectParts.push(`${sql} AS ${alias}`);
    usedSources.add(col.source);
    // 出力列の dataType は表示整形用。extra 列は displayType(実型)を優先する
    // (フィルタ/SQL は colDef.dataType='text' のままで変更なし)。
    outputColumns.push({
      id: col.id,
      label: col.label,
      alias,
      source: col.source,
      dataType: colDef.displayType ?? colDef.dataType,
    });
  }

  // 会員詳細ページへのリンク用に、会員氏名カラムを含む行レベルレポートでは
  // m.id を隠しカラムとして SELECT に追加する。
  //   - 出力カラム(outputColumns)には含めないため、ヘッダー・CSV・Excel には出ない
  //   - 結果行に MEMBER_LINK_ID_ALIAS キーとして付与され、画面側がリンク生成に使う
  const hasExplicitGroupBy = !!(definition.group_by && definition.group_by.length > 0);
  const selectsMemberName = definition.columns.some(
    (c) => c.source === MEMBER_NAME_SOURCE && !c.aggregate,
  );
  const selectsMemberId = definition.columns.some((c) => c.source === MEMBER_ID_SOURCE);
  // GROUP BY がある場合も m.name が非集計なら m.id を注入してリンクを生成する
  const injectMemberLinkId =
    selectsMemberName && !selectsMemberId && !!findColumn(reportType, MEMBER_ID_SOURCE);
  if (injectMemberLinkId) {
    selectParts.push(`${sourceSql(MEMBER_ID_SOURCE)} AS ${MEMBER_LINK_ID_ALIAS}`);
    usedSources.add(MEMBER_ID_SOURCE);
  }

  // GROUP BY
  const groupByCols: string[] = [];
  if (definition.group_by && definition.group_by.length > 0) {
    // 明示的 GROUP BY フィールドを追加
    const explicitGroupSources = new Set(definition.group_by.map((g) => g.field));
    for (const g of definition.group_by.sort((a, b) => a.level - b.level)) {
      validateColumn(reportType, g.field, extraColumns);
      groupByCols.push(sourceSql(g.field));
      usedSources.add(g.field);
    }
    // Postgres 必須要件: 非集計の SELECT カラムも GROUP BY に追加する
    for (const c of definition.columns) {
      if (!c.aggregate && !explicitGroupSources.has(c.source)) {
        groupByCols.push(sourceSql(c.source));
      }
    }
    // 隠しカラム m.id も GROUP BY に含める
    if (injectMemberLinkId && !explicitGroupSources.has(MEMBER_ID_SOURCE)) {
      groupByCols.push(sourceSql(MEMBER_ID_SOURCE));
    }
  } else {
    // 集計列があれば、非集計列を全て GROUP BY に入れる(Postgres の必須要件)
    const hasAgg = definition.columns.some((c) => c.aggregate);
    if (hasAgg) {
      for (const c of definition.columns) {
        if (!c.aggregate) {
          groupByCols.push(sourceSql(c.source));
        }
      }
      // 隠しカラム m.id を SELECT に追加した場合は GROUP BY にも含める(Postgres 必須要件)
      if (injectMemberLinkId) {
        groupByCols.push(sourceSql(MEMBER_ID_SOURCE));
      }
    }
  }

  // ORDER BY
  const orderParts: string[] = [];
  if (definition.sort) {
    for (const s of definition.sort) {
      validateColumn(reportType, s.field, extraColumns);
      const dir = s.direction === 'asc' ? 'ASC' : 'DESC';
      orderParts.push(`${sourceSql(s.field)} ${dir} NULLS LAST`);
      usedSources.add(s.field);
    }
  }
  // 明示的な sort が無い行レベル出力は、既定で日付の降順(最新が上)にする。
  // GROUP BY / 集計列がある場合は行を畳むため適用しない(SQL 不整合を避ける)。
  if (orderParts.length === 0 && groupByCols.length === 0) {
    const defaultSort = DEFAULT_SORT_SOURCE[reportType];
    if (defaultSort && findColumn(reportType, defaultSort)) {
      orderParts.push(`${sourceSql(defaultSort)} DESC NULLS LAST`);
      usedSources.add(defaultSort);
    }
  }

  // WHERE
  const whereParts: string[] = [...schema.baseWhere];
  if (definition.filters) {
    whereParts.push(
      `(${buildFilterGroup(reportType, definition.filters, pb, currentUserId, extraColumns)})`,
    );
    // 使用フィールドも JOIN 検出に使う
    collectFilterFields(definition.filters).forEach((f) => usedSources.add(f));
  }

  // HAVING
  const havingParts: string[] = [];
  if (definition.having) {
    for (const h of definition.having) {
      const colDef = validateColumn(reportType, h.field, extraColumns);
      const srcSql = sourceSql(h.field);
      const colSql = h.aggregate ? AGG_SQL[h.aggregate](srcSql) : srcSql;
      // operatorToSql は WHERE 用だが HAVING でもそのまま使える
      havingParts.push(operatorToSql(colSql, h, pb, colDef, currentUserId));
      usedSources.add(h.field);
    }
  }

  // JOIN 検出
  const joins = detectRequiredJoins(reportType, [...usedSources]);

  // 行数制限
  const rowLimit = Math.min(
    Math.max(1, definition.row_limit ?? DEFAULT_ROW_LIMIT),
    MAX_EXCEL_ROW_LIMIT,
  );

  // SQL 組み立て
  // 注: statement_timeout は exec_report_sql 関数定義側で SET 済み(30s)。
  //     ここで SET LOCAL を含めると複文扱いになり exec_report_sql のセミコロン
  //     検出に引っかかるため、SELECT のみで構成する。
  const sql = [
    `SELECT ${selectParts.join(', ')}`,
    `FROM public.${schema.baseTable} ${schema.baseAlias}`,
    ...joins,
    whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '',
    groupByCols.length > 0 ? `GROUP BY ${groupByCols.join(', ')}` : '',
    havingParts.length > 0 ? `HAVING ${havingParts.join(' AND ')}` : '',
    orderParts.length > 0 ? `ORDER BY ${orderParts.join(', ')}` : '',
    `LIMIT ${rowLimit}`,
  ]
    .filter(Boolean)
    .join('\n');

  return { sql, params: pb.toArray(), columns: outputColumns };
}

function collectFilterFields(group: ReportFilterGroup): string[] {
  const out: string[] = [];
  for (const c of group.conditions) {
    if ('group' in c) out.push(...collectFilterFields(c.group));
    else out.push(c.field);
  }
  return out;
}
