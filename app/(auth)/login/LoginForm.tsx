'use client';

import { Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { devLogin } from '@/lib/domain/dev_auth_actions';
import { createClient } from '@/lib/supabase/client';

const ACCENT = '#00C896';

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
      {/* メールアドレス */}
      <div className="relative">
        <Mail
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
          aria-hidden="true"
        />
        <input
          id="identifier"
          type={devAuth ? 'text' : 'email'}
          required
          placeholder={devAuth ? 'ユーザー名' : 'メールアドレス'}
          autoComplete={devAuth ? 'username' : 'email'}
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          className="h-11 w-full rounded-md border border-gray-200 pl-10 pr-4 text-sm text-gray-800 outline-none transition-colors placeholder:text-gray-400 focus:border-[#00C896] focus:ring-1 focus:ring-[#00C896]"
        />
      </div>

      {/* パスワード */}
      <div className="relative">
        <Lock
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
          aria-hidden="true"
        />
        <input
          id="password"
          type={showPassword ? 'text' : 'password'}
          required
          placeholder="パスワード"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-11 w-full rounded-md border border-gray-200 pl-10 pr-10 text-sm text-gray-800 outline-none transition-colors placeholder:text-gray-400 focus:border-[#00C896] focus:ring-1 focus:ring-[#00C896]"
        />
        <button
          type="button"
          onClick={() => setShowPassword((v) => !v)}
          aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
          tabIndex={-1}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600 focus:outline-none"
        >
          {showPassword ? (
            <EyeOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Eye className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>

      {/* エラー */}
      {error && (
        <p className="text-center text-sm text-red-500" role="alert">
          {error}
        </p>
      )}

      {/* ログインボタン */}
      <button
        type="submit"
        disabled={pending}
        className="mt-2 h-11 w-full rounded-md text-sm font-bold tracking-widest text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        style={{ backgroundColor: ACCENT }}
      >
        {pending ? 'ログイン中...' : 'LOGIN'}
      </button>
    </form>
  );
}
