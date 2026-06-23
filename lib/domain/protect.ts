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
 */
export async function applyProtect(
  supabase: SupabaseClient,
  memberId: string,
  userId: string,
  userFullName: string,
  sBunrui: string | null | undefined,
): Promise<void> {
  if (!memberId || !sBunrui) return;

  try {
    const rule = await findMatchingRule(supabase, sBunrui);
    if (!rule) return;

    const expiresAt = calcExpiresAt(rule).toISOString();

    const { error } = await supabase
      .from('members')
      .update({
        owner_name_raw:      userFullName,
        protect_expires_at:  expiresAt,
        protect_by_user_id:  userId,
        updated_at:          new Date().toISOString(),
      })
      .eq('id', memberId)
      .is('deleted_at', null);

    if (error) {
      // migration 23/24 未適用時は column not found エラーになる → 無視
      console.warn('[protect] applyProtect failed:', error.message);
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

  const { data, error } = await supabase
    .from('members')
    .update({
      owner_name_raw:      'free',
      protect_expires_at:  null,
      protect_by_user_id:  null,
      updated_at:          now,
    })
    .lt('protect_expires_at', now)
    .is('deleted_at', null)
    .select('id');

  if (error) {
    console.error('[protect] expireProtects failed:', error.message);
    return 0;
  }

  return data?.length ?? 0;
}
