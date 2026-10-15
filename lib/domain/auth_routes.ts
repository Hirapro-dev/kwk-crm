/**
 * ログイン状態によって転送する先を決める(純粋関数。middleware から使う)。
 *
 *   - 未ログインで /login・/reset-password 以外 → /login
 *   - ログイン済みで /login → /
 *   - /reset-password はログイン済みでも通す。プロフィールから再設定メールを送った人は
 *     ログインしたままリンクを開くため、ここで / へ転送すると新しいパスワードを入力できない
 *     (2026-10-16 修正。以前はログイン済みなら /reset-password も / へ転送していた)
 *
 * 転送しないときは null。
 */
export function authRedirectPath(pathname: string, isLoggedIn: boolean): '/login' | '/' | null {
  const onLogin = pathname.startsWith('/login');
  const onResetPassword = pathname.startsWith('/reset-password');

  if (!isLoggedIn && !onLogin && !onResetPassword) return '/login';
  if (isLoggedIn && onLogin) return '/';
  return null;
}
