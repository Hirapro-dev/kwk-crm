/**
 * 開発専用の擬似認証(仕様書スコープ外 / 本番禁止)
 *
 * `DEV_AUTH_BYPASS=1` のときのみ有効。
 * Cookie `dev_auth_user=admin` をセットされていれば、固定の admin ユーザーとして
 * ログイン済み扱いにする。
 *
 * 用途: Supabase 未接続でも UI 全体のレイアウト確認をしたい場合のみ。
 *
 * 本番運用では DEV_AUTH_BYPASS を絶対に設定しないこと。
 */

import type { AppUser } from '@/lib/domain/types';

export const DEV_AUTH_COOKIE = 'dev_auth_user';
export const DEV_AUTH_USERS: Record<string, AppUser & { password: string }> = {
  admin: {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'admin@dev.local',
    first_name: '管理者',
    last_name: 'デモ',
    full_name: 'デモ 管理者',
    role: 'admin',
    is_active: true,
    password: 'admin',
  },
};

export function isDevAuthEnabled(): boolean {
  return process.env.DEV_AUTH_BYPASS === '1';
}

export function devAuthCheckCredentials(
  username: string,
  password: string,
): AppUser | null {
  if (!isDevAuthEnabled()) return null;
  const u = DEV_AUTH_USERS[username];
  if (!u) return null;
  if (u.password !== password) return null;
  const { password: _, ...user } = u;
  return user;
}

export function devAuthUserFromCookie(cookieValue: string | undefined): AppUser | null {
  if (!isDevAuthEnabled()) return null;
  if (!cookieValue) return null;
  const u = DEV_AUTH_USERS[cookieValue];
  if (!u) return null;
  const { password: _, ...user } = u;
  return user;
}
