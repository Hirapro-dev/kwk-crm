import { describe, expect, it } from 'vitest';
import {
  BuilderError,
  DEFAULT_ROW_LIMIT,
  MAX_EXCEL_ROW_LIMIT,
  buildReportQuery,
} from '../../lib/reports/builder_v2';
import { type AllowedColumnDef, isSafeIdentifier } from '../../lib/reports/schema_all';

const CURRENT_USER = '11111111-1111-1111-1111-111111111111';

/** field_definitions 由来の extra jsonb 列(extra_columns.ts が生成する形)を模したもの */
function extraCol(key: string): AllowedColumnDef {
  return {
    source: `m.extra:${key}`,
    label: key,
    dataType: 'text',
    displayType: 'number',
    isExtra: true,
    filterable: true,
    sortable: true,
    groupable: true,
    aggregatable: false,
  };
}

/**
 * 出力列の別名(SQL の AS 句)は、実行結果の行から値を取り出すキーとしてそのまま使う。
 * Postgres は引用符なしの識別子を小文字に畳むため、別名に大文字が混ざると
 * 「SQL 上の別名」と「返ってくる行のキー」が食い違い、画面では値が空欄になる
 * (実例: extra キー "SCPP_0.01%借入利用額" の列だけ値が表示されなかった)。
 */
describe('出力列の別名(Postgres の識別子規則との整合)', () => {
  function buildWithExtra(keys: string[]) {
    const cols = keys.map(extraCol);
    return buildReportQuery(
      'RT01',
      { columns: cols.map((c, i) => ({ id: `c${i}`, source: c.source, label: c.label })) },
      CURRENT_USER,
      cols,
    );
  }

  it('大文字を含む extra キーでも別名は小文字の英数字とアンダースコアだけになる', () => {
    const q = buildWithExtra(['SCPP_0.01%借入利用額']);
    const [alias] = q.columns.map((c) => c.alias);
    expect(alias).toMatch(/^[a-z_][a-z0-9_]*$/);
    expect(q.sql).toContain(`m.extra->>'SCPP_0.01%借入利用額' AS ${alias}`);
  });

  it('記号や日本語が潰れて同じ形になる extra キー同士でも別名が衝突しない', () => {
    // 「借入利用額」と「借入出金額」は文字数が同じため、非英数字を '_' に置換するだけだと同一になる
    const q = buildWithExtra(['SCPP_0.01%借入利用額', 'SCPP_0.01%借入出金額']);
    const aliases = q.columns.map((c) => c.alias);
    expect(aliases).toHaveLength(2);
    expect(new Set(aliases).size).toBe(2);
  });

  it('別名は Postgres の識別子上限(63文字)を超えない(超えると末尾が切られてキーが一致しなくなる)', () => {
    const q = buildWithExtra(['とても長い案件名'.repeat(20)]); // 160文字のキー
    expect(q.columns).toHaveLength(1);
    for (const c of q.columns) expect(c.alias.length).toBeLessThanOrEqual(63);
  });

  it('通常カラムの別名は従来どおり変わらない(保存済みダッシュボード等との互換)', () => {
    const q = buildReportQuery(
      'RT02',
      {
        columns: [
          { id: 'c1', source: 'm.id', label: '会員ID' },
          { id: 'c2', source: 'apps.payment_amount', label: '総入金額', aggregate: 'sum' },
        ],
      },
      CURRENT_USER,
    );
    expect(q.columns.map((c) => c.alias)).toEqual(['m_id', 'sum_apps_payment_amount']);
  });
});

describe('isSafeIdentifier(仕様書 §9.8)', () => {
  it('alias.column のみ許可', () => {
    expect(isSafeIdentifier('m.name')).toBe(true);
    expect(isSafeIdentifier('m')).toBe(true);
    expect(isSafeIdentifier('m_x.col_1')).toBe(true);
  });

  it('SQL インジェクション風文字を拒否', () => {
    expect(isSafeIdentifier('m.name; DROP TABLE')).toBe(false);
    expect(isSafeIdentifier("m.name'")).toBe(false);
    expect(isSafeIdentifier('m.*')).toBe(false);
    expect(isSafeIdentifier('m.name--')).toBe(false);
  });
});

describe('buildReportQuery(仕様書 §9.8)', () => {
  it('RT01 で会員一覧の SQL を組み立てる', () => {
    const q = buildReportQuery(
      'RT01',
      {
        columns: [
          { id: 'c1', source: 'm.id', label: '会員ID' },
          { id: 'c2', source: 'm.name', label: '氏名' },
        ],
      },
      CURRENT_USER,
    );
    expect(q.sql).toContain('FROM public.members m');
    expect(q.sql).toContain('m.id AS m_id');
    expect(q.sql).toContain('m.name AS m_name');
    expect(q.sql).toContain('m.deleted_at IS NULL');
    expect(q.sql).toContain(`LIMIT ${DEFAULT_ROW_LIMIT}`);
    expect(q.params).toEqual([]);
  });

  it('JOIN を必要に応じて差し込む(owner エイリアス使用時のみ)', () => {
    const q = buildReportQuery(
      'RT01',
      {
        columns: [
          { id: 'c1', source: 'm.name', label: '氏名' },
          { id: 'c2', source: 'owner.full_name', label: '担当者' },
        ],
      },
      CURRENT_USER,
    );
    expect(q.sql).toContain('LEFT JOIN public.users owner');
  });

  it('集計関数を使うと GROUP BY が自動付与される', () => {
    const q = buildReportQuery(
      'RT02',
      {
        columns: [
          { id: 'c1', source: 'm.id', label: '会員ID' },
          { id: 'c2', source: 'm.name', label: '氏名' },
          { id: 'c3', source: 'apps.id', label: '申込件数', aggregate: 'count_distinct' },
        ],
      },
      CURRENT_USER,
    );
    expect(q.sql).toContain('COUNT(DISTINCT apps.id)');
    expect(q.sql).toContain('GROUP BY m.id, m.name');
  });

  it('フィルタはパラメータ化される', () => {
    const q = buildReportQuery(
      'RT01',
      {
        columns: [{ id: 'c1', source: 'm.id', label: '会員ID' }],
        filters: {
          logic: 'AND',
          conditions: [
            { field: 'm.name', op: 'contains', value: '山田' },
            { field: 'm.total_amount', op: 'gte', value: 1000000 },
          ],
        },
      },
      CURRENT_USER,
    );
    expect(q.sql).toContain('m.name ILIKE $1');
    expect(q.sql).toContain('m.total_amount >= $2');
    expect(q.params).toEqual(['%山田%', 1000000]);
  });

  it('${current_user} プレースホルダが展開される', () => {
    const q = buildReportQuery(
      'RT01',
      {
        columns: [{ id: 'c1', source: 'm.id', label: '会員ID' }],
        filters: {
          logic: 'AND',
          conditions: [{ field: 'm.owner_id', op: 'equals', value: '${current_user}' }],
        },
      },
      CURRENT_USER,
    );
    expect(q.params).toEqual([CURRENT_USER]);
  });

  it('LIKE のメタ文字をエスケープ', () => {
    const q = buildReportQuery(
      'RT01',
      {
        columns: [{ id: 'c1', source: 'm.id', label: '会員ID' }],
        filters: {
          logic: 'AND',
          conditions: [{ field: 'm.name', op: 'contains', value: '100%' }],
        },
      },
      CURRENT_USER,
    );
    expect(q.params[0]).toBe('%100\\%%');
  });

  it('ホワイトリストにないカラムを拒否', () => {
    expect(() =>
      buildReportQuery(
        'RT01',
        {
          columns: [{ id: 'c1', source: 'm.password', label: 'パスワード' }],
        },
        CURRENT_USER,
      ),
    ).toThrow(BuilderError);
  });

  it('不正な識別子を拒否(SQL インジェクション防御)', () => {
    expect(() =>
      buildReportQuery(
        'RT01',
        {
          columns: [{ id: 'c1', source: 'm.name; DROP TABLE members --', label: '攻撃' }],
        },
        CURRENT_USER,
      ),
    ).toThrow(BuilderError);
  });

  it('row_limit が MAX_EXCEL_ROW_LIMIT を超えない', () => {
    const q = buildReportQuery(
      'RT01',
      {
        columns: [{ id: 'c1', source: 'm.id', label: '会員ID' }],
        row_limit: 999_999_999,
      },
      CURRENT_USER,
    );
    expect(q.sql).toContain(`LIMIT ${MAX_EXCEL_ROW_LIMIT}`);
  });

  it('OR / AND ネストグループが構築される', () => {
    const q = buildReportQuery(
      'RT01',
      {
        columns: [{ id: 'c1', source: 'm.id', label: '会員ID' }],
        filters: {
          logic: 'AND',
          conditions: [
            { field: 'm.total_amount', op: 'gte', value: 1000000 },
            {
              group: {
                logic: 'OR',
                conditions: [
                  { field: 'm.owner_id', op: 'is_null' },
                  { field: 'm.owner_id', op: 'equals', value: CURRENT_USER },
                ],
              },
            },
          ],
        },
      },
      CURRENT_USER,
    );
    expect(q.sql).toContain('m.total_amount >= $1');
    expect(q.sql).toMatch(/\(.*m\.owner_id IS NULL OR m\.owner_id = \$2.*\)/);
  });

  /**
   * 生成した SQL は exec_report_sql(migration 07)にそのまま渡されるため、
   * 同関数の入力ガードを通る形でなければ実行時に必ず失敗する。
   *
   * なぜこの契約が必要か:
   *   クエリタイムアウト30秒(仕様書 §9.8-3)は exec_report_sql の関数定義側で
   *   `SET statement_timeout = '30s'` として担保している。
   *   builder が `SET LOCAL statement_timeout = ...;` を先頭に付けると複文になり、
   *   同関数のセミコロン検出ガードに弾かれて実行できなくなるため、
   *   builder は SELECT 単文のみを組み立てる契約とする。
   */
  it('SELECT 単文のみを生成する(exec_report_sql の入力ガードを通る)', () => {
    // JOIN / GROUP BY / HAVING / ORDER BY / フィルタを全部使った複雑なケースで確認する
    const q = buildReportQuery(
      'RT02',
      {
        columns: [
          { id: 'c1', source: 'm.id', label: '会員ID' },
          { id: 'c2', source: 'owner.full_name', label: '担当者' },
          { id: 'c3', source: 'apps.payment_amount', label: '総入金額', aggregate: 'sum' },
        ],
        filters: {
          logic: 'AND',
          conditions: [{ field: 'm.name', op: 'contains', value: 'テスト' }],
        },
        sort: [{ field: 'm.total_amount', direction: 'desc' }],
      },
      CURRENT_USER,
    );

    // 単純なクエリで通っただけにならないよう、複雑な形が生成されていることを先に確認する
    expect(q.sql).toContain('LEFT JOIN public.users owner');
    expect(q.sql).toContain('GROUP BY');
    expect(q.sql).toContain('ORDER BY');

    // migration 07 の exec_report_sql が課すガードと同じ条件で検証する
    expect(/^(SET LOCAL statement_timeout\s*=\s*\d+\s*;\s*)?SELECT/i.test(q.sql)).toBe(true);
    expect(/;\s*[^;\s].*\S/.test(q.sql)).toBe(false);
  });

  it('集計列に aggregatable=false の列を拒否', () => {
    // m.name は aggregatable 指定なし(=false 扱い)
    expect(() =>
      buildReportQuery(
        'RT01',
        {
          columns: [{ id: 'c1', source: 'm.name', label: '氏名', aggregate: 'sum' }],
        },
        CURRENT_USER,
      ),
    ).toThrow(BuilderError);
  });

  it('未知のレポートタイプを拒否', () => {
    expect(() =>
      buildReportQuery(
        'RT99' as never,
        { columns: [{ id: 'c1', source: 'm.id', label: 'X' }] },
        CURRENT_USER,
      ),
    ).toThrow(BuilderError);
  });
});
