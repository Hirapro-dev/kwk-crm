'use client';

import { UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { inviteUser } from '@/lib/domain/user_actions';

const ROLES = ['admin', 'manager', 'sales', 'viewer'] as const;
type Role = (typeof ROLES)[number];

/**
 * 新規ユーザー招待フォーム (admin限定)。
 *
 * メアド + 姓 + 名 + ロールを入力し、Supabase Admin API でメール招待する。
 * 招待リンク経由でパスワード設定するとログイン可能になる。
 * デフォルトロールは sales (過去会話で確定)。
 */
export function InviteUserForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [role, setRole] = useState<Role>('sales');
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    startTransition(async () => {
      const res = await inviteUser({
        email,
        last_name: lastName,
        first_name: firstName || undefined,
        role,
      });
      if (res.ok) {
        setMsg({ type: 'ok', text: res.message ?? '送信しました' });
        setEmail('');
        setLastName('');
        setFirstName('');
        setRole('sales');
        router.refresh();
      } else {
        setMsg({ type: 'err', text: res.error ?? '失敗' });
      }
    });
  };

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <UserPlus className="h-3.5 w-3.5" />
        新規ユーザーを招待
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader className="border-b py-3">
        <CardTitle className="text-sm">新規ユーザーを招待</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="invite-email">メールアドレス *</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="example@aaa.com"
            />
            <p className="text-xs text-muted-foreground">
              このメールアドレス宛に招待メールが送信されます。
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="invite-last">姓 *</Label>
              <Input
                id="invite-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                maxLength={100}
                placeholder="例: 山田"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="invite-first">名</Label>
              <Input
                id="invite-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                maxLength={100}
                placeholder="例: 太郎"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="invite-role">権限</Label>
            <Select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </div>
          {msg && (
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
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                setMsg(null);
              }}
              disabled={pending}
            >
              キャンセル
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? '送信中…' : '招待メールを送信'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
