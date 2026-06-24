'use client';

import { Eye, EyeOff, Lock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createClient } from '@/lib/supabase/client';

const ACCENT = '#00C896';

export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('パスワードは8文字以上で入力してください');
      return;
    }
    if (password !== confirm) {
      setError('パスワードが一致しません');
      return;
    }

    startTransition(async () => {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError('パスワードの更新に失敗しました。リンクが無効か期限切れの可能性があります。');
        return;
      }
      setDone(true);
      // 3秒後にログイン画面へ
      setTimeout(() => router.push('/login'), 3000);
    });
  };

  if (done) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-gray-700">
          パスワードを更新しました。
          <br />
          ログイン画面へ移動します...
        </p>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      {/* 新しいパスワード */}
      <div className="relative">
        <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
        <input
          type={showPassword ? 'text' : 'password'}
          required
          placeholder="新しいパスワード（8文字以上）"
          autoComplete="new-password"
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
          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>

      {/* 確認用パスワード */}
      <div className="relative">
        <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
        <input
          type={showPassword ? 'text' : 'password'}
          required
          placeholder="パスワードを再入力"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="h-11 w-full rounded-md border border-gray-200 pl-10 pr-4 text-sm text-gray-800 outline-none transition-colors placeholder:text-gray-400 focus:border-[#00C896] focus:ring-1 focus:ring-[#00C896]"
        />
      </div>

      {error && (
        <p className="text-center text-sm text-red-500" role="alert">{error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="h-11 w-full rounded-md text-sm font-bold tracking-widest text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        style={{ backgroundColor: ACCENT }}
      >
        {pending ? '更新中...' : 'パスワードを更新'}
      </button>
    </form>
  );
}
