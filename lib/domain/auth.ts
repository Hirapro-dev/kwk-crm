import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { DEV_AUTH_COOKIE, devAuthUserFromCookie, isDevAuthEnabled } from '@/lib/dev_auth';
import { createClient } from '@/lib/supabase/server';
import type { AppUser } from './types';

/**
 * 現ログインユーザーを取得。
 *
 * 優先順:
 *   1. DEV_AUTH_BYPASS=1 のとき: dev_auth_user Cookie からダミー admin を返す
 *   2. それ以外: Supabase Auth + public.users の通常フロー(仕様書 §7.3)
 *
 * 未ログイン時は /login にリダイレクト。
 */
export async function getCurrentUser(): Promise<AppUser> {
  if (isDevAuthEnabled()) {
    const jar = await cookies();
    const cookieVal = jar.get(DEV_AUTH_COOKIE)?.value;
    const devUser = devAuthUserFromCookie(cookieVal);
    if (devUser) return devUser;
    redirect('/login');
  }

  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) {
    redirect('/login');
  }

  const { data, error } = await supabase
    .from('users')
    .select('id, email, first_name, last_name, full_name, role, is_active')
    .eq('id', authUser.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error || !data) {
    throw new Error('ユーザー情報が見つかりません。管理者に連絡してください。');
  }

  return data as AppUser;
}
