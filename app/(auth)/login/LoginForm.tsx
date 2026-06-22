'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { devLogin } from '@/lib/domain/dev_auth_actions';
import { createClient } from '@/lib/supabase/client';

/**
 * ログインフォーム
 *
 * - devAuth=true のとき: Server Action devLogin() でダミー認証
 * - 通常: Supabase auth.signInWithPassword
 *
 * 仕様書 §12.1: React Hook Form + Zod は将来導入。本フォームは最小実装。
 */
export function LoginForm({ devAuth = false }: { devAuth?: boolean }) {
  const router = useRouter();
  const [identifier, setIdentifier] = useState(devAuth ? 'admin' : '');
  const [password, setPassword] = useState(devAuth ? 'admin' : '');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (devAuth) {
      startTransition(async () => {
        const res = await devLogin(identifier, password);
        if (!res.ok) {
          setError(res.error ?? 'ログインに失敗しました');
          return;
        }
        router.push('/');
        router.refresh();
      });
      return;
    }

    // 通常モード
    startTransition(async () => {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: identifier,
        password,
      });
      if (signInError) {
        setError(
          signInError.message?.includes('未設定')
            ? signInError.message
            : 'メールアドレスまたはパスワードが正しくありません',
        );
        return;
      }
      router.push('/');
      router.refresh();
    });
  };

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <div className="space-y-2">
        <label htmlFor="identifier" className="text-sm font-medium">
          {devAuth ? 'ユーザー名' : 'メールアドレス'}
        </label>
        <input
          id="identifier"
          type={devAuth ? 'text' : 'email'}
          required
          autoComplete={devAuth ? 'username' : 'email'}
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="password" className="text-sm font-medium">
          パスワード
        </label>
        <div className="relative">
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
            aria-pressed={showPassword}
            tabIndex={-1}
            className="absolute inset-y-0 right-0 flex items-center justify-center px-3 text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring rounded-r-md"
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        {pending ? 'ログイン中...' : 'ログイン'}
      </button>
    </form>
  );
}
