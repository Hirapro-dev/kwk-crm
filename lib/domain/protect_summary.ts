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

  // 2) 全ユーザー(削除除く)を取得。同名アカウントの名寄せに使う(users は小規模)。
  type U = {
    id: string;
    full_name: string | null;
    email: string;
    is_active: boolean;
    role: string | null;
  };
  const { data: allUsers, error: uErr } = await supabase
    .from('users')
    .select('id, full_name, email, is_active, role')
    .is('deleted_at', null);
  if (uErr) throw new Error(`ユーザー取得に失敗: ${uErr.message}`);

  const byId = new Map<string, U>();
  // 氏名 → 代表アカウント(有効を優先)。同名の有効/無効アカウントを一人に名寄せする。
  const repByName = new Map<string, U>();
  for (const raw of allUsers ?? []) {
    const u: U = {
      id: raw.id as string,
      full_name: (raw.full_name as string | null) ?? null,
      email: raw.email as string,
      is_active: raw.is_active as boolean,
      role: (raw.role as string | null) ?? null,
    };
    byId.set(u.id, u);
    if (u.full_name) {
      const cur = repByName.get(u.full_name);
      // 未登録、または現代表が無効で今回が有効なら差し替え(有効アカウントを代表に)
      if (!cur || (!cur.is_active && u.is_active)) repByName.set(u.full_name, u);
    }
  }

  // 3) counts を氏名で名寄せ合算(同名の有効+無効アカウントを1行にまとめる)
  const grouped = new Map<string, { rep: U | null; count: number }>();
  for (const [uid, count] of counts) {
    let key: string;
    let rep: U | null;
    if (uid === NO_HOLDER_KEY) {
      key = NO_HOLDER_KEY;
      rep = null;
    } else {
      const u = byId.get(uid);
      if (u?.full_name) {
        key = `name:${u.full_name}`;
        rep = repByName.get(u.full_name) ?? u;
      } else {
        // 氏名不明(削除済み等) → 名寄せせず単独扱い
        key = `id:${uid}`;
        rep = u ?? null;
      }
    }
    const g = grouped.get(key) ?? { rep, count: 0 };
    g.count += count;
    grouped.set(key, g);
  }

  // 4) rows 組み立て + activeFilter / roleFilter + 件数降順ソート
  const rows: ProtectSummaryRow[] = Array.from(grouped.entries())
    .map(([key, g]) => {
      if (key === NO_HOLDER_KEY) {
        return {
          user_id: null,
          user_name: '(担当なし)',
          is_active: false,
          role: null,
          protect_count: g.count,
        };
      }
      const rep = g.rep;
      return {
        user_id: rep?.id ?? null,
        user_name: rep ? (rep.full_name ?? rep.email) : '(不明)',
        is_active: rep?.is_active ?? false,
        role: rep?.role ?? null,
        protect_count: g.count,
      };
    })
    .filter((r) => {
      if (filter.activeFilter === 'active' && !r.is_active) return false;
      if (filter.activeFilter === 'inactive' && r.is_active) return false;
      if (filter.roleFilter !== 'all' && r.role !== filter.roleFilter) return false;
      return true;
    })
    .sort((a, b) => b.protect_count - a.protect_count);

  const totalCount = rows.reduce((s, r) => s + r.protect_count, 0);

  return { rows, totalCount, holderCount: rows.length };
}
