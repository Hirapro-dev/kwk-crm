/**
 * sales ユーザー別サマリ ドメインロジック。
 *
 * applications.acquirer_id (申込獲得者) を sales ロールのユーザーに紐付けて、
 * 期間内の入金額合計・入金件数をユーザー単位で集計する。
 *
 * 表示対象: role='sales' AND is_active=true AND deleted_at IS NULL のユーザー全員
 *           (申込実績ゼロのユーザーも行を表示し、0円/0件と表示する)
 *
 * 入金の定義:
 *   - applications.payment_amount IS NOT NULL AND > 0
 *
 * 期間絞り込み:
 *   - applications.payment_date を基準にする (inclusive)
 *
 * 案件絞り込み:
 *   - applications.project_id で絞る (全案件 or 単一案件)
 *
 * 仕様書 §5.1 / §5.6 参照。
 */

import { createClient } from '@/lib/supabase/server';

export interface SalesSummaryRow {
  /** users.id (uuid) */
  user_id: string;
  /** 表示名(full_name または email) */
  user_name: string;
  /** メアド(参考表示) */
  email: string;
  /** 期間内 / 案件絞り込み後の入金額合計 */
  total_payment_amount: number;
  /** 期間内 / 案件絞り込み後の入金件数 */
  payment_count: number;
  /** ユーザーが有効かどうか */
  is_active: boolean;
}

export interface SalesSummaryFilter {
  /** 入金日の開始(YYYY-MM-DD inclusive)。null=制限なし */
  paymentFrom: string | null;
  /** 入金日の終了(YYYY-MM-DD inclusive)。null=制限なし */
  paymentTo: string | null;
  /** 絞り込み対象の案件ID。null=全案件 */
  projectId: number | null;
  /** ユーザーの有効/無効フィルター。'all'=全員(デフォルト) */
  activeFilter: 'all' | 'active' | 'inactive';
}

export interface SalesSummaryResult {
  rows: SalesSummaryRow[];
  /** 全sales合計の入金額 */
  grandTotalAmount: number;
  /** 全sales合計の入金件数 */
  grandTotalCount: number;
}

/**
 * ユーザー別の入金集計を取得する。
 *
 * 集計方法:
 *   1. applications を取得 (deleted_at IS NULL, payment_amount > 0, 期間/案件で絞り込み)
 *   2. acquirer_id ごとに JS 側で SUM / COUNT
 *   3. 集計に登場した acquirer_id を逆引きしてユーザー名を取得
 *      ※ role は問わず。旧実装の role='sales' 限定は acquirer_id の実態と合わなかったため廃止
 *   4. 入金額降順にソートして返す
 */
export async function getSalesSummary(filter: SalesSummaryFilter): Promise<SalesSummaryResult> {
  const supabase = await createClient();

  // 1) 期間・案件フィルタ付きで applications 取得
  let q = supabase
    .from('applications')
    .select('acquirer_id, acquirer_name_raw, payment_amount')
    .is('deleted_at', null)
    .not('payment_amount', 'is', null)
    .gt('payment_amount', 0);

  if (filter.paymentFrom) q = q.gte('payment_date', filter.paymentFrom);
  if (filter.paymentTo) q = q.lte('payment_date', filter.paymentTo);
  if (filter.projectId) q = q.eq('project_id', filter.projectId);

  const { data: apps, error: aErr } = await q;
  if (aErr) throw new Error(`申込集計に失敗: ${aErr.message}`);

  // 2) acquirer_id ごとに集計 (acquirer_name_raw も控えておき、ユーザー未解決時のフォールバックに使う)
  const summaryMap = new Map<string, { sum: number; count: number; nameRaw: string | null }>();
  let grandTotalAmount = 0;
  let grandTotalCount = 0;
  for (const row of apps ?? []) {
    if (!row.acquirer_id) continue;
    const amt = Number(row.payment_amount ?? 0);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    const cur = summaryMap.get(row.acquirer_id) ?? { sum: 0, count: 0, nameRaw: null };
    cur.sum += amt;
    cur.count += 1;
    if (!cur.nameRaw && row.acquirer_name_raw) cur.nameRaw = row.acquirer_name_raw;
    summaryMap.set(row.acquirer_id, cur);
    grandTotalAmount += amt;
    grandTotalCount += 1;
  }

  // 3) 集計に登場した acquirer_id のユーザー情報を取得 (role 不問)。
  //    退職者などの論理削除済みユーザーも氏名解決できるよう deleted_at では絞らない。
  const acquirerIds = Array.from(summaryMap.keys());
  const userMap = new Map<
    string,
    { id: string; full_name: string | null; email: string; is_active: boolean }
  >();

  if (acquirerIds.length > 0) {
    const { data: users, error: uErr } = await supabase
      .from('users')
      .select('id, full_name, email, is_active')
      .in('id', acquirerIds);
    if (uErr) throw new Error(`ユーザー取得に失敗: ${uErr.message}`);
    for (const u of users ?? []) {
      userMap.set(
        u.id,
        u as { id: string; full_name: string | null; email: string; is_active: boolean },
      );
    }
  }

  // 4) rows 組み立て: 入金額降順ソート + activeFilter 適用
  //    氏名は users(削除済み含む) → acquirer_name_raw → '(不明)' の順で解決する。
  const rows: SalesSummaryRow[] = acquirerIds
    .map((uid) => {
      const u = userMap.get(uid);
      const s = summaryMap.get(uid) ?? { sum: 0, count: 0, nameRaw: null };
      const name = u?.full_name || u?.email || s.nameRaw || '(不明)';
      return {
        user_id: uid,
        user_name: name,
        email: u?.email ?? '',
        total_payment_amount: s.sum,
        payment_count: s.count,
        // 解決できたユーザーの有効フラグ。未解決(削除済みでもない不明ID)は無効扱い。
        is_active: u?.is_active ?? false,
      };
    })
    .filter((r) => {
      if (filter.activeFilter === 'active') return r.is_active;
      if (filter.activeFilter === 'inactive') return !r.is_active;
      return true;
    })
    .sort((a, b) => b.total_payment_amount - a.total_payment_amount);

  return { rows, grandTotalAmount, grandTotalCount };
}

/**
 * フィルタ用: 案件マスタ全件(is_active 問わず表示、ただし削除済みは除外)。
 */
export async function listProjectsForFilter(): Promise<{ id: number; name: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('id, name')
    .order('name', { ascending: true });
  if (error) throw new Error(`案件マスタ取得に失敗: ${error.message}`);
  return data ?? [];
}
