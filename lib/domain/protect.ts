/**
 * 時限プロテクト設定ロジック (仕様書 §要機能)
 *
 * 対応歴の「状態」チェックボックスに応じて、会員のプロテクトを自動設定する。
 * ルールは flow_rules テーブルで管理され、/settings/flows から変更可能。
 *
 * フォールバック: flow_rules / protect カラム未適用時は処理をスキップする。
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { calcExpiresAt, findMatchingRule } from './flow_rules';

/**
 * 会員のプロテクトを設定する。
 * flow_rules テーブルを参照してルールを動的に決定する。
 *
 * @param supabase       サーバーサイドクライアント
 * @param memberId       対象会員 K-XXXXXXX
 * @param userId         プロテクト担当になるユーザーの UUID
 * @param userFullName   表示名 (owner_name_raw に格納)
 * @param sBunrui        活動の小分類(パイプ区切り)
 * @param userRole       対応者のロール。ルールの適用ロールに含まれない場合はスキップ
 */
export async function applyProtect(
  supabase: SupabaseClient,
  memberId: string,
  userId: string,
  userFullName: string,
  sBunrui: string | null | undefined,
  userRole?: string | null,
): Promise<void> {
  if (!memberId || !sBunrui) return;

  try {
    // userRole 指定時はルールの適用ロールで絞り込む(対象外ロールなら rule=null → 何もしない)
    const rule = await findMatchingRule(supabase, sBunrui, userRole);
    if (!rule) return;

    const expiresAt = calcExpiresAt(rule).toISOString();

    // 全ロールでプロテクトできるよう SECURITY DEFINER 関数を使う(migration 38)。
    // sales 等が自分担当でない会員にプロテクトを付ける場合も RLS に阻まれない。
    const { error: rpcError } = await supabase.rpc('apply_member_protect', {
      p_member_id: memberId,
      p_user_id: userId,
      p_expires_at: expiresAt,
      p_owner_name: userFullName,
    });

    if (rpcError) {
      // migration 38/43/48 未適用(関数なし)時は直接更新にフォールバック。
      // 適用ルールは関数と同じ:
      //   - 別の「有効」ユーザーがアクティブにプロテクト中(期限内) → 上書きしない
      //   - 保持者が「無効」ユーザー(退職者等) or 本人 or free/期限切れ → (再)設定
      const { data: cur } = await supabase
        .from('members')
        .select(
          'protect_by_user_id, protect_expires_at, protect_by_user:users!members_protect_by_user_id_fkey(is_active)',
        )
        .eq('id', memberId)
        .is('deleted_at', null)
        .maybeSingle();

      const curExp = cur?.protect_expires_at as string | null | undefined;
      const curUser = cur?.protect_by_user_id as string | null | undefined;
      const holderActive =
        (cur as { protect_by_user?: { is_active?: boolean } | null } | null)?.protect_by_user
          ?.is_active === true;
      const isActive = !!curExp && new Date(curExp).getTime() > Date.now();
      if (isActive && curUser && curUser !== userId && holderActive) {
        // 別の「有効」ユーザーがアクティブにプロテクト中 → 何もしない
        // (無効保持者なら上書きを許可する)
        return;
      }

      // owner_name_raw(永久担当) はプロテクトと独立のため更新しない(migration 59 と整合)。
      const { error } = await supabase
        .from('members')
        .update({
          protect_expires_at: expiresAt,
          protect_by_user_id: userId,
          protect_released_at: null, // 再プロテクトで解除マーカーをクリア
          updated_at: new Date().toISOString(),
        })
        .eq('id', memberId)
        .is('deleted_at', null);
      if (error) {
        console.warn('[protect] applyProtect failed:', error.message);
      }
    }
  } catch (e) {
    console.warn('[protect] applyProtect exception:', e);
  }
}

/**
 * 期限切れのプロテクトを一括解除する。
 * Vercel Cron から呼び出す (app/api/cron/expire-protects/route.ts)。
 * service_role クライアントを渡すこと。
 *
 * @returns 解除件数
 */
export async function expireProtects(supabase: SupabaseClient): Promise<number> {
  const now = new Date().toISOString();

  // owner_name_raw(永久担当) はプロテクトと独立のため、期限切れ解除でも更新しない(migration 59 と整合)。
  const baseUpdate = {
    protect_expires_at: null,
    protect_by_user_id: null,
    updated_at: now,
  };

  // 解除日時を記録して解除(解除後経過日数の算出に使う)。
  // migration 55 未適用(protect_released_at 列なし)の場合は列を外して再実行し、
  // cron が止まらないようにする(解除自体は継続、記録のみスキップ)。
  let { data, error } = await supabase
    .from('members')
    .update({ ...baseUpdate, protect_released_at: now })
    .lt('protect_expires_at', now)
    .is('deleted_at', null)
    .select('id');

  if (error && /protect_released_at/.test(error.message)) {
    ({ data, error } = await supabase
      .from('members')
      .update(baseUpdate)
      .lt('protect_expires_at', now)
      .is('deleted_at', null)
      .select('id'));
  }

  if (error) {
    console.error('[protect] expireProtects failed:', error.message);
    return 0;
  }

  return data?.length ?? 0;
}
