import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from './types';

/**
 * Server Components / Server Actions / Route Handlers 向け Supabase クライアント。
 * RLS が効くため、ログイン中ユーザーの権限で動作する。
 *
 * 仕様書 §7.2: Row Level Security により担当者の閲覧範囲を制御。
 *
 * Supabase 未設定モード:
 *   URL/Key が無い場合はモッククライアントを返す。
 *   middleware で /login 以外はリダイレクト済みのため通常は呼ばれないが、
 *   万が一呼ばれてもページが落ちないようにする。
 */
export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return createMockServerClient();
  }

  const cookieStore = await cookies();
  return createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components から呼ばれた場合は無視。
          // Middleware が refresh を担当する。
        }
      },
    },
  });
}

/**
 * service_role キーを使うサーバー専用クライアント。
 * 仕様書 §12.4: service role key はサーバー側のみ。クライアント露出禁止。
 */
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return createMockServerClient();
  }
  return createServerClient<Database>(url, serviceKey, {
    cookies: {
      getAll() {
        return [];
      },
      setAll() {
        /* noop */
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Supabase 未設定時のスタブ。
 * すべてのクエリで「未設定」エラーを返す。
 */
function createMockServerClient() {
  const notConfigured = {
    message:
      'Supabase が未設定です。.env.local に NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY を設定してください。',
    name: 'NotConfigured',
    status: 500,
  } as const;
  const errResult = { data: null, error: notConfigured };
  // biome-ignore lint/suspicious/noExplicitAny: モック用途
  const stub: any = {
    auth: {
      async getUser() {
        return { data: { user: null }, error: null };
      },
      async getSession() {
        return { data: { session: null }, error: null };
      },
      async signOut() {
        return { error: null };
      },
    },
    from() {
      const chain: any = new Proxy(
        {},
        {
          get: (_, prop) => {
            if (prop === 'then') return undefined;
            if (prop === 'maybeSingle' || prop === 'single')
              return async () => errResult;
            return () => chain;
          },
        },
      );
      chain[Symbol.asyncIterator] = async function* () {
        yield errResult;
      };
      // 末端で await できるよう Promise を兼ねる
      Object.assign(chain, {
        then: (resolve: (v: typeof errResult) => unknown) => resolve(errResult),
      });
      return chain;
    },
    rpc: async () => errResult,
  };
  return stub;
}
