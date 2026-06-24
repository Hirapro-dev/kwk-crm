'use client';

import { Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { devLogin } from '@/lib/domain/dev_auth_actions';
import { createClient } from '@/lib/supabase/client';

const ACCENT = '#00C896';

export function LoginForm({ devAuth = false }: { devAuth?: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'reset'>('login');

  // ログインフォーム
  const [identifier, setIdentifier] = useState(devAuth ? 'admin' : '');
  const [password, setPassword] = useState(devAuth ? 'admin' : '');
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginPending, startLoginTransition] = useTransition();

  // パスワードリセット
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetPending, startResetTransition] = useTransition();

  const onLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);

    if (devAuth) {
      startLoginTransition(async () => {
        const res = await devLogin(identifier, password);
        if (!res.ok) {
          setLoginError(res.error ?? 'ログインに失敗しました');
          return;
        }
        router.push('/');
        router.refresh();
      });
      return;
    }

    startLoginTransition(async () => {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: identifier,
        password,
      });
      if (error) {
        setLoginError(
          error.message?.includes('未設定')
            ? error.message
            : 'メールアドレスまたはパスワードが正しくありません',
        );
        return;
      }
      router.push('/');
      router.refresh();
    });
  };

  const onReset = (e: React.FormEvent) => {
    e.preventDefault();
    setResetError(null);

    startResetTransition(async () => {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/reset-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, { redirectTo });
      if (error) {
        setResetError('送信に失敗しました。メールアドレスを確認してください。');
        return;
      }
      setResetSent(true);
    });
  };

  // ---- パスワードリセット画面 ----
  if (mode === 'reset') {
    return (
      <div className="space-y-6">
        <div className="space-y-1 text-center">
          <h2 className="text-lg font-semibold text-gray-800">パスワードをリセット</h2>
          <p className="text-sm text-gray-500">
            登録のメールアドレスを入力してください。
            <br />
            リセット用リンクをお送りします。
          </p>
        </div>

        {resetSent ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-gray-700">
              <span className="font-medium text-[#00C896]">{resetEmail}</span> に
              <br />
              リセット用リンクを送信しました。
              <br />
              メールをご確認ください。
            </p>
            <button
              type="button"
              onClick={() => { setMode('login'); setResetSent(false); setResetEmail(''); }}
              className="text-sm text-[#00C896] hover:underline"
            >
              ← ログイン画面に戻る
            </button>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={onReset}>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
              <input
                type="email"
                required
                placeholder="登録のメールアドレス"
                autoComplete="email"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                className="h-11 w-full rounded-md border border-gray-200 pl-10 pr-4 text-sm text-gray-800 outline-none transition-colors placeholder:text-gray-400 focus:border-[#00C896] focus:ring-1 focus:ring-[#00C896]"
              />
            </div>

            {resetError && (
              <p className="text-center text-sm text-red-500" role="alert">{resetError}</p>
            )}

            <button
              type="submit"
              disabled={resetPending}
              className="h-11 w-full rounded-md text-sm font-bold tracking-widest text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: ACCENT }}
            >
              {resetPending ? '送信中...' : 'リセットメールを送信'}
            </button>

            <button
              type="button"
              onClick={() => setMode('login')}
              className="block w-full text-center text-sm text-gray-500 hover:text-gray-700"
            >
              ← ログイン画面に戻る
            </button>
          </form>
        )}
      </div>
    );
  }

  // ---- ログイン画面 ----
  return (
    <form className="space-y-4" onSubmit={onLogin}>
      {/* メールアドレス */}
      <div className="relative">
        <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
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
        <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
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
      {loginError && (
        <p className="text-center text-sm text-red-500" role="alert">{loginError}</p>
      )}

      {/* ログインボタン */}
      <button
        type="submit"
        disabled={loginPending}
        className="h-11 w-full rounded-md text-sm font-bold tracking-widest text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        style={{ backgroundColor: ACCENT }}
      >
        {loginPending ? 'ログイン中...' : 'LOGIN'}
      </button>

      {/* パスワードを忘れた方 */}
      <button
        type="button"
        onClick={() => setMode('reset')}
        className="block w-full text-center text-sm text-gray-500 hover:text-[#00C896] transition-colors"
      >
        パスワードを忘れた方はこちら
      </button>
    </form>
  );
}
