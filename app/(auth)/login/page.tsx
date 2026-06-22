/**
 * ログイン画面
 * 仕様書 §7.3: Supabase Auth (email/password)
 *
 * DEV_AUTH_BYPASS=1 のとき: 開発用バイパスログインを表示(admin/admin など固定)
 */

import { isDevAuthEnabled } from '@/lib/dev_auth';
import { LoginForm } from './LoginForm';

export default function LoginPage() {
  const devAuth = isDevAuthEnabled();
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-sm space-y-6 rounded-lg border bg-card p-8 shadow-sm">
        <header className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">ひらプロCRM</h1>
          {devAuth ? (
            <>
              <p className="text-sm text-muted-foreground">開発バイパスモード</p>
              <p className="text-xs text-amber-600">
                ⚠ 本番では絶対に DEV_AUTH_BYPASS を有効にしないこと
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">メールアドレスでログイン</p>
          )}
        </header>
        <LoginForm devAuth={devAuth} />
        {devAuth && (
          <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-900">
            テストアカウント: <strong>admin</strong> / <strong>admin</strong>
            <br />
            UI 動作確認用です。データ表示は Supabase 接続後に有効になります。
          </p>
        )}
      </div>
    </main>
  );
}
