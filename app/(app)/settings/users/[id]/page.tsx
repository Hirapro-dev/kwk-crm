/**
 * /settings/users/[id] — ユーザー詳細 (管理者用)
 *
 * 基本情報の表示 + 権限/有効の編集 + ログインパスワード設定 + 削除。
 * /settings 配下のため layout.tsx で admin チェック済み。
 */

import { UserRoleEditor } from '@/app/(app)/admin/users/UserRoleEditor';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/domain/auth';
import { getUserById } from '@/lib/domain/users_admin';
import { formatDateTime } from '@/lib/utils/date';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { UserDeleteButton } from '../UserDeleteButton';
import { UserPasswordForm } from '../UserPasswordForm';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function UserDetailPage({ params }: PageProps) {
  const { id } = await params;
  const me = await getCurrentUser();
  const user = await getUserById(id);
  if (!user) notFound();

  const isSelf = user.id === me.id;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Link href="/settings/users" className="text-sm text-primary hover:underline">
          ← ユーザー一覧へ
        </Link>
      </div>

      {/* 基本情報 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between border-b py-3">
          <CardTitle className="text-base">{user.full_name ?? '(氏名未設定)'}</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{user.role}</Badge>
            {user.is_active ? (
              <Badge variant="success">有効</Badge>
            ) : (
              <Badge variant="destructive">無効</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-4">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <Item label="氏名" value={user.full_name ?? '-'} />
            <Item label="メールアドレス" value={user.email} />
            <Item label="姓" value={user.last_name ?? '-'} />
            <Item label="名" value={user.first_name ?? '-'} />
            <Item label="権限" value={user.role} />
            <Item label="有効" value={user.is_active ? '有効' : '無効'} />
            <Item label="旧Salesforce ID" value={user.legacy_sf_id ?? '-'} mono />
            <Item label="登録日時" value={formatDateTime(user.created_at)} />
          </dl>
        </CardContent>
      </Card>

      {/* 権限・有効の編集 */}
      <Card>
        <CardHeader className="border-b py-3">
          <CardTitle className="text-sm">権限・有効状態</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <UserRoleEditor
            userId={user.id}
            initialRole={user.role}
            initialActive={user.is_active}
            isSelf={isSelf}
          />
        </CardContent>
      </Card>

      {/* ログインパスワード設定 */}
      <Card>
        <CardHeader className="border-b py-3">
          <CardTitle className="text-sm">ログインパスワード</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <UserPasswordForm userId={user.id} />
        </CardContent>
      </Card>

      {/* 削除 */}
      <Card>
        <CardHeader className="border-b py-3">
          <CardTitle className="text-sm">削除</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          {isSelf ? (
            <p className="text-sm text-muted-foreground">自分自身は削除できません。</p>
          ) : (
            <UserDeleteButton
              userId={user.id}
              userName={user.full_name ?? user.email}
              isSelf={isSelf}
              redirectTo="/settings/users"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Item({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col border-b pb-2 last:border-b-0">
      <dt className="text-xs font-semibold tracking-wide text-slate-600">{label}</dt>
      <dd className={`text-[15px] text-slate-900 ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  );
}
