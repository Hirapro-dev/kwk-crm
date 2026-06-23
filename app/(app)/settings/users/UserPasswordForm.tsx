'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { setUserPassword } from '@/lib/domain/user_actions';
import { useState, useTransition } from 'react';

/**
 * 対象ユーザーのログインパスワードを admin が設定する小フォーム。
 * 8文字以上。設定後はそのメール+パスワードでログイン可能になる。
 */
export function UserPasswordForm({ userId }: { userId: string }) {
  const [password, setPassword] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await setUserPassword({ user_id: userId, password });
      if (!res.ok) {
        setError(res.error ?? 'パスワード設定に失敗しました');
        return;
      }
      setSuccess('パスワードを設定しました');
      setPassword('');
    });
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <Label htmlFor="new-password">ログインパスワード</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id="new-password"
          type="text"
          className="w-64"
          placeholder="8文字以上"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
        <Button type="submit" disabled={pending || password.length < 8}>
          {pending ? '設定中…' : 'パスワードを設定'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        設定すると、このユーザーは「メールアドレス + このパスワード」でログインできます。
        ログインアカウントが未作成のユーザー(CSV取込のみ)は、先に「招待」が必要です。
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {success && <p className="text-xs text-green-700">{success}</p>}
    </form>
  );
}
