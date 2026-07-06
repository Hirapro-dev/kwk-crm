/**
 * プロテクト保持者別サマリ ドメインロジック。
 *
 * members.protect_by_user_id (プロテクト保持者) ごとに、
 * 現在有効なプロテクト(protect_expires_at > now)の件数を集計する。
 *
 * 有効/無効フィルタ:
 *   - 保持者ユーザーの is_active を基準にする(入金サマリの activeFilter と同じ意味)。
 *   - 'active'   … 有効な(在籍中の)ユーザーが保持しているプロテクト
 *   - 'inactive' … 無効な(退職等の)ユーザーが保持したままのプロテクト
 *   - 'all'      … すべて
 *
 * ※ 期限切れプロテクトは cron (expire-protects) で protect_expires_at=null に解除されるため、
 *   ここでの「有効なプロテクト」は protect_expires_at が未来のものを指す。
 *
 * 仕様書 §5.4 (members.protect_*) / §5.12 参照。
 */

import { createClient } from '@/lib/supabase/server';

export type ProtectActiveFilter = 'all' | 'active' | 'inactive';

export interface ProtectSummaryRow {
  /** protect_by_user_id (uuid)。担当なしの場合は null */
  user_id: string | null;
  /** 表示名(full_name または email) */
  user_name: string;
  /** 保持者ユーザーが有効(在籍中)かどうか */
  is_active: boolean;
  /** 保持者ユーザーのロール(admin/manager/sales/viewer/support)。逆引き不能時は null */
  role: string | null;
  /** 現在有効なプロテクト件数 */
  protect_count: number;
}

export interface ProtectSummaryResult {
  rows: ProtectSummaryRow[];
  /** フィルタ適用後の合計プロテクト件数 */
  totalCount: number;
  /** フィルタ適用後の保持者数 */
  holderCount: number;
}

const NO_HOLDER_KEY = '(未割当)';

/**
 * プロテクト保持者別の有効プロテクト件数を集計する。
 *
 * 集計方法:
 *   1. 有効プロテクト(protect_expires_at > now)の members から protect_by_user_id のみ取得
 *      (1000件超に備えてページング取得)
 *   2. 保持者IDごとに JS 側で COUNT
 *   3. 登場した保持者IDを逆引きしてユーザー名・is_active を取得
 *   4. activeFilter を適用し、件数降順にソートして返す
 */
export async function getProtectSummary(filter: {
  activeFilter: ProtectActiveFilter;
  /** ロール絞り込み。'all'=全ロール。それ以外は該当ロールの保持者のみ */
  roleFilter: string;
}): Promise<ProtectSummaryResult> {
  const supabase = await createClient();
  const now = new Date().toISOString();

  // 1) 有効プロテクトの保持者IDを取得(件数が多い場合に備えてページング)
  const PAGE = 1000;
  const counts = new Map<string, number>();
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('members')
      .select('protect_by_user_id')
      .is('deleted_at', null)
      .not('protect_expires_at', 'is', null)
      .gt('protect_expires_at', now)
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`プロテクト集計に失敗: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) {
      const uid = (r.protect_by_user_id as string | null) ?? NO_HOLDER_KEY;
      counts.set(uid, (counts.get(uid) ?? 0) + 1);
    }
    if (rows.length < PAGE) break;
  }

  // 2) 登場した保持者ユーザーの情報を逆引き
  const userIds = Array.from(counts.keys()).filter((k) => k !== NO_HOLDER_KEY);
  const userMap = new Map<
    string,
    { full_name: string | null; email: string; is_active: boolean; role: string | null }
  >();
  if (userIds.length > 0) {
    const { data: users, error } = await supabase
      .from('users')
      .select('id, full_name, email, is_active, role')
      .in('id', userIds);
    if (error) throw new Error(`ユーザー取得に失敗: ${error.message}`);
    for (const u of users ?? []) {
      userMap.set(u.id, {
        full_name: u.full_name as string | null,
        email: u.email as string,
        is_active: u.is_active as boolean,
        role: (u.role as string | null) ?? null,
      });
    }
  }

  // 3) rows 組み立て + activeFilter 適用 + 件数降順ソート
  const rows: ProtectSummaryRow[] = Array.from(counts.entries())
    .map(([uid, count]) => {
      const u = uid === NO_HOLDER_KEY ? undefined : userMap.get(uid);
      return {
        user_id: uid === NO_HOLDER_KEY ? null : uid,
        // 担当なし / 逆引き不能はいずれも「無効」側として扱う
        user_name: uid === NO_HOLDER_KEY ? '(担当なし)' : u ? (u.full_name ?? u.email) : '(不明)',
        is_active: u?.is_active ?? false,
        role: u?.role ?? null,
        protect_count: count,
      };
    })
    .filter((r) => {
      if (filter.activeFilter === 'active' && !r.is_active) return false;
      if (filter.activeFilter === 'inactive' && r.is_active) return false;
      // ロール絞り込み(特定ロール選択時は該当ロールの保持者のみ)
      if (filter.roleFilter !== 'all' && r.role !== filter.roleFilter) return false;
      return true;
    })
    .sort((a, b) => b.protect_count - a.protect_count);

  const totalCount = rows.reduce((s, r) => s + r.protect_count, 0);

  return { rows, totalCount, holderCount: rows.length };
}
