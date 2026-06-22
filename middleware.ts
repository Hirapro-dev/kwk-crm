import { type NextRequest, NextResponse } from 'next/server';
import { DEV_AUTH_COOKIE } from '@/lib/dev_auth';
import { updateSession } from '@/lib/supabase/middleware';

/**
 * Next.js Middleware:
 *   - DEV_AUTH_BYPASS=1 のとき: dev_auth_user Cookie で擬似ログイン判定
 *   - Supabase 設定済みのとき: 通常の updateSession
 *   - どちらも無いとき: /login のみ通す
 */
export async function middleware(request: NextRequest) {
  const devAuth = process.env.DEV_AUTH_BYPASS === '1';
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // ----- 1. 開発バイパスモード -----
  if (devAuth) {
    const cookieVal = request.cookies.get(DEV_AUTH_COOKIE)?.value;
    const isLoggedIn = Boolean(cookieVal);
    const onLogin = request.nextUrl.pathname.startsWith('/login');

    if (!isLoggedIn && !onLogin) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
    if (isLoggedIn && onLogin) {
      const url = request.nextUrl.clone();
      url.pathname = '/';
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // ----- 2. Supabase 未設定モード(ログイン画面だけ表示可能) -----
  if (!supabaseUrl || !supabaseKey) {
    if (request.nextUrl.pathname.startsWith('/login')) {
      return NextResponse.next();
    }
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // ----- 3. 通常モード -----
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * 以下を除く全てのリクエストパスにマッチ:
     * - _next/static (静的ファイル)
     * - _next/image (画像最適化)
     * - favicon.ico, png/jpg/svg などの画像
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
