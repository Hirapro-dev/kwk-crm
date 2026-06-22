import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './types';

/**
 * クライアント (Browser) コンポーネント向け Supabase クライアント。
 * 仕様書 §12.1: DB呼び出しは lib/supabase/ 経由でのみ。
 *
 * Supabase 未設定モード:
 *   URL / Key が未設定の場合は throw せず、auth.signInWithPassword 等が
 *   「環境変数を設定してください」というエラーを返すだけのモックを返す。
 *   ログイン画面の見た目チェックだけしたい開発初期に有用。
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return createMockClient();
  }
  return createBrowserClient<Database>(url, key);
}

function createMockClient() {
  const notConfigured = {
    error: {
      message:
        'Supabase が未設定です。.env.local に NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY を設定してください。',
      name: 'NotConfigured',
      status: 500,
    },
  } as const;
  // 最小限のスタブ。auth と from のみ実装。他は呼び出さない想定。
  // biome-ignore lint/suspicious/noExplicitAny: モック用途
  const stub: any = {
    auth: {
      async signInWithPassword() {
        return notConfigured;
      },
      async signOut() {
        return { error: null };
      },
      async getUser() {
        return { data: { user: null }, error: null };
      },
      async getSession() {
        return { data: { session: null }, error: null };
      },
    },
    from() {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: notConfigured.error }),
            single: async () => ({ data: null, error: notConfigured.error }),
          }),
          maybeSingle: async () => ({ data: null, error: notConfigured.error }),
          single: async () => ({ data: null, error: notConfigured.error }),
        }),
      };
    },
    rpc: async () => ({ data: null, error: notConfigured.error }),
  };
  return stub;
}
