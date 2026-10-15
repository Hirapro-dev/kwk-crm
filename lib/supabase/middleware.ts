import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import { authRedirectPath } from '@/lib/domain/auth_routes';
import type { Database } from './types';

/**
 * Next.js middleware から呼び出される Supabase セッション更新ロジック。
 * Cookie のリフレッシュを担当し、未ログイン時は /login にリダイレクト。
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options?: CookieOptions }[],
        ) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 未ログインでアプリ画面 → /login、ログイン済みでログイン画面 → /。
  // /reset-password はログイン済みでも通す(プロフィールから送った再設定メールのリンク用)
  const redirectTo = authRedirectPath(request.nextUrl.pathname, Boolean(user));
  if (redirectTo) {
    const url = request.nextUrl.clone();
    url.pathname = redirectTo;
    return NextResponse.redirect(url);
  }

  return response;
}
