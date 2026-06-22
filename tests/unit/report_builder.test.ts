import { describe, expect, it } from 'vitest';
import {
  buildReportQuery,
  BuilderError,
  DEFAULT_ROW_LIMIT,
  MAX_EXCEL_ROW_LIMIT,
} from '../../lib/reports/builder_v2';
import { isSafeIdentifier } from '../../lib/reports/schema_all';

const CURRENT_USER = '11111111-1111-1111-1111-111111111111';

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
    expect(q.sql).toContain('statement_timeout = 30000');
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
          columns: [
            { id: 'c1', source: "m.name; DROP TABLE members --", label: '攻撃' },
          ],
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
