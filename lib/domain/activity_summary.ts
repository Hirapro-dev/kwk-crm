import { createClient } from '@/lib/supabase/server';

/**
 * 対応歴サマリ (DB: activities / X軸: 対応者 owner_id)。
 *
 * 対応者ごとに以下を集計する:
 *   - 対応歴作成数: 期間内の活動レコード数
 *   - 通電数: s_bunrui に「通電」を含む活動数
 *   - 通電率: 通電数 / 対応歴作成数
 *
 * 120万件規模のため JS 集計は不可。DB 側で GROUP BY 集計する
 * exec_report_sql RPC(SELECT 専用・パラメータ化・RLS適用)を利用する。
 */

export interface ActivityOwnerRow {
  owner_id: string | null;
  owner_name: string;
  total: number;
  connected: number;
  /** 通電率 0〜1 */
  rate: number;
}

export async function getActivitySummaryByOwner(opts: {
  from: string | null;
  to: string | null;
}): Promise<ActivityOwnerRow[]> {
  const supabase = await createClient();
  const fromTs = opts.from ? `${opts.from}T00:00:00+09:00` : null;
  const toTs = opts.to ? `${opts.to}T23:59:59.999+09:00` : null;

  // exec_report_sql のガード(先頭が SELECT / セミコロン複文禁止)に合わせ、
  // 先頭は SELECT で始め、末尾セミコロンは付けない。
  const sql =
    'SELECT a.owner_id AS owner_id, u.full_name AS owner_name, ' +
    'count(*)::int AS total, ' +
    "count(*) FILTER (WHERE a.s_bunrui ~ '通電')::int AS connected " +
    'FROM activities a ' +
    'LEFT JOIN users u ON u.id = a.owner_id ' +
    'WHERE a.deleted_at IS NULL ' +
    'AND ($1::timestamptz IS NULL OR a.registered_datetime >= $1::timestamptz) ' +
    'AND ($2::timestamptz IS NULL OR a.registered_datetime <= $2::timestamptz) ' +
    'GROUP BY a.owner_id, u.full_name ' +
    'ORDER BY total DESC';

  try {
    const { data, error } = await supabase.rpc('exec_report_sql', {
      query_sql: sql,
      query_params: [fromTs, toTs],
    });
    if (error) {
      console.warn('[activity_summary] exec_report_sql failed:', error.message);
      return [];
    }
    const rows = (data ?? []) as Array<{
      owner_id: string | null;
      owner_name: string | null;
      total: number | string;
      connected: number | string;
    }>;
    return rows.map((r) => {
      const total = Number(r.total) || 0;
      const connected = Number(r.connected) || 0;
      return {
        owner_id: r.owner_id,
        owner_name: r.owner_name ?? '(未割当)',
        total,
        connected,
        rate: total > 0 ? connected / total : 0,
      };
    });
  } catch (e) {
    console.warn('[activity_summary] exception:', e instanceof Error ? e.message : e);
    return [];
  }
}
