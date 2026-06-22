'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  sendMyPasswordResetEmail,
  updateMyEmail,
  updateMyName,
  updateMyPassword,
} from '@/lib/domain/account_actions';

interface Props {
  isAdmin: boolean;
  currentLastName: string;
  currentFirstName: string;
  currentEmail: string;
}

/**
 * プロフィール編集フォーム群 (Client Component)。
 *
 *   1. 氏名変更 (admin のみ表示)
 *   2. メアド変更 (確認メール)
 *   3. パスワード変更 (現在PW → 新PW)
 *   4. パスワードリセット (メールリンク)
 */
export function AccountForms({
  isAdmin,
  currentLastName,
  currentFirstName,
  currentEmail,
}: Props) {
  return (
    <>
      {isAdmin && (
        <NameForm initialLast={currentLastName} initialFirst={currentFirstName} />
      )}
      <EmailForm initialEmail={currentEmail} />
      <PasswordForm />
      <ResetForm />
    </>
  );
}

// ----------------------------------------------------------------------------
// 1. 名前
// ----------------------------------------------------------------------------
function NameForm({
  initialLast,
  initialFirst,
}: {
  initialLast: string;
  initialFirst: string;
}) {
  const [lastName, setLastName] = useState(initialLast);
  const [firstName, setFirstName] = useState(initialFirst);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    startTransition(async () => {
      const res = await updateMyName({
        last_name: lastName,
        first_name: firstName || undefined,
      });
      setMsg(
        res.ok
          ? { type: 'ok', text: res.message ?? '更新しました' }
          : { type: 'err', text: res.error ?? '失敗' },
      );
    });
  };

  return (
    <Card>
      <CardHeader className="border-b py-3">
        <CardTitle className="text-sm">氏名を変更 (管理者のみ)</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="last-name">姓 *</Label>
              <Input
                id="last-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                maxLength={100}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="first-name">名</Label>
              <Input
                id="first-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                maxLength={100}
              />
            </div>
          </div>
          <FormMessage msg={msg} />
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? '保存中…' : '更新'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// 2. メアド
// ----------------------------------------------------------------------------
function EmailForm({ initialEmail }: { initialEmail: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (email === initialEmail) {
      setMsg({ type: 'err', text: '現在と同じメールアドレスです' });
      return;
    }
    startTransition(async () => {
      const res = await updateMyEmail({ email });
      setMsg(
        res.ok
          ? { type: 'ok', text: res.message ?? '送信しました' }
          : { type: 'err', text: res.error ?? '失敗' },
      );
    });
  };

  return (
    <Card>
      <CardHeader className="border-b py-3">
        <CardTitle className="text-sm">メールアドレスを変更</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="email">新しいメールアドレス</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              変更には新しいメールアドレス宛に届く確認リンクのクリックが必要です。
            </p>
          </div>
          <FormMessage msg={msg} />
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? '送信中…' : '確認メールを送信'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// 3. パスワード変更
// ----------------------------------------------------------------------------
function PasswordForm() {
  const [current, setCurrent] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    startTransition(async () => {
      const res = await updateMyPassword({
        current_password: current,
        new_password: newPw,
        confirm_password: confirm,
      });
      if (res.ok) {
        setCurrent('');
        setNewPw('');
        setConfirm('');
      }
      setMsg(
        res.ok
          ? { type: 'ok', text: res.message ?? '変更しました' }
          : { type: 'err', text: res.error ?? '失敗' },
      );
    });
  };

  return (
    <Card>
      <CardHeader className="border-b py-3">
        <CardTitle className="text-sm">パスワードを変更</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="current-pw">現在のパスワード</Label>
            <Input
              id="current-pw"
              type={show ? 'text' : 'password'}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="new-pw">新しいパスワード (6文字以上)</Label>
              <Input
                id="new-pw"
                type={show ? 'text' : 'password'}
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="confirm-pw">新しいパスワード(確認)</Label>
              <Input
                id="confirm-pw"
                type={show ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
            </div>
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={show}
              onChange={(e) => setShow(e.target.checked)}
            />
            パスワードを表示
          </label>
          <FormMessage msg={msg} />
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? '変更中…' : 'パスワードを変更'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// 4. パスワードリセット (メールリンク送信)
// ----------------------------------------------------------------------------
function ResetForm() {
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const onClick = () => {
    setMsg(null);
    if (!window.confirm('登録メールアドレス宛にリセットメールを送信します。よろしいですか?')) {
      return;
    }
    startTransition(async () => {
      const res = await sendMyPasswordResetEmail();
      setMsg(
        res.ok
          ? { type: 'ok', text: res.message ?? '送信しました' }
          : { type: 'err', text: res.error ?? '失敗' },
      );
    });
  };

  return (
    <Card>
      <CardHeader className="border-b py-3">
        <CardTitle className="text-sm">パスワードを忘れた場合</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        <p className="text-sm text-muted-foreground">
          現在のパスワードが不明な場合は、登録メールアドレス宛にパスワードリセット用のリンクを送信します。
          リンクをクリックして新しいパスワードを設定してください。
        </p>
        <FormMessage msg={msg} />
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={onClick} disabled={pending}>
            {pending ? '送信中…' : 'リセットメールを送信'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// 共通: メッセージ表示
// ----------------------------------------------------------------------------
function FormMessage({
  msg,
}: {
  msg: { type: 'ok' | 'err'; text: string } | null;
}) {
  if (!msg) return null;
  return (
    <p
      role={msg.type === 'err' ? 'alert' : 'status'}
      className={
        msg.type === 'err'
          ? 'text-sm text-destructive'
          : 'text-sm text-green-700'
      }
    >
      {msg.text}
    </p>
  );
}
