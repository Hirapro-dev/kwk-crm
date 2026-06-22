'use server';

import { cookies } from 'next/headers';
import {
  DEV_AUTH_COOKIE,
  devAuthCheckCredentials,
  isDevAuthEnabled,
} from '@/lib/dev_auth';

export interface DevLoginResult {
  ok: boolean;
  error?: string;
}

/**
 * 開発用ログイン(DEV_AUTH_BYPASS=1 のときのみ動作)
 */
export async function devLogin(username: string, password: string): Promise<DevLoginResult> {
  if (!isDevAuthEnabled()) {
    return { ok: false, error: 'DEV_AUTH_BYPASS が有効ではありません' };
  }
  const u = devAuthCheckCredentials(username, password);
  if (!u) {
    return { ok: false, error: 'ユーザー名またはパスワードが正しくありません' };
  }
  const jar = await cookies();
  jar.set(DEV_AUTH_COOKIE, username, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8, // 8 時間
  });
  return { ok: true };
}

export async function devLogout(): Promise<void> {
  const jar = await cookies();
  jar.delete(DEV_AUTH_COOKIE);
}
