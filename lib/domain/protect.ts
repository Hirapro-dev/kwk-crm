/**
 * 時限プロテクト設定ロジック (仕様書 §要機能)
 *
 * 対応歴の「状態」チェックボックスに応じて、会員のプロテクトを自動設定する。
 *
 *   通電     → owner がその会員の プロテクト担当 に 7日間 なる
 *   接触対応  → 10日間 (通電より強い)
 *
 * どちらも s_bunrui (パイプ区切り) に格納されている。
 * 両方チェックされた場合は接触対応(10日)が優先。
 * 常に上書き・期限リセット。
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const PROTECT_DAYS_CONNECTED = 7;   // 通電
const PROTECT_DAYS_CONTACT   = 10;  // 接触対応

export type ProtectTrigger = 'connected' | 'contact' | null;

/** s_bunrui 文字列からプロテクトトリガーを判定 */
export function detectProtectTrigger(sBunrui: string | null | undefined): ProtectTrigger {
  if (!sBunrui) return null;
  const flags = sBunrui.split('|').map((s) => s.trim());
  if (flags.includes('接触対応')) return 'contact';   // 強い方を先に
  if (flags.includes('通電'))    return 'connected';
  return null;
}

/** プロテクト日数を返す */
export function protectDays(trigger: ProtectTrigger): number {
  if (trigger === 'contact')   return PROTECT_DAYS_CONTACT;
  if (trigger === 'connected') return PROTECT_DAYS_CONNECTED;
  return 0;
}

/**
 * 会員のプロテクトを設定する。
 * migration 23 未適用時はエラーをキャッチして無視する(フォールバック)。
 *
 * @param supabase  anon or service_role クライアント (RLS考慮でanon推奨)
 * @param memberId  対象会員 K-XXXXXXX
 * @param userId    プロテクト担当になるユーザーの UUID
 * @param userFullName  表示名 (owner_name_raw に格納)
 * @param trigger   'connected' | 'contact'
 */
export async function applyProtect(
  supabase: SupabaseClient,
  memberId: string,
  userId: string,
  userFullName: string,
  trigger: ProtectTrigger,
): Promise<void> {
  if (!trigger || !memberId) return;

  const days = protectDays(trigger);
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  try {
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
      // migration 23 未適用時は column not found エラーになる → 無視
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
