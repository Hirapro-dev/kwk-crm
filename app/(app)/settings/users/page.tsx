/**
 * /settings/users — ユーザー管理 (管理者用)
 *
 * /admin/users の機能 + 新規招待ボタンを統合した版。
 * /settings 配下のため、layout.tsx で admin チェック済 (二重チェックなし)。
 */

import { Suspense } from 'react';
import { PanelFilterBar, PanelHeader } from '@/components/layout/PanelHeader';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getCurrentUser } from '@/lib/domain/auth';
import { listAllUsers } from '@/lib/domain/users_admin';
import type { UserRole } from '@/lib/domain/types';
import { formatDateTime } from '@/lib/utils/date';
import { UserRoleEditor } from '@/app/(app)/admin/users/UserRoleEditor';
import { InviteUserForm } from './InviteUserForm';
import { UserDeleteButton } from './UserDeleteButton';
import { UsersFilterBar } from './UsersFilterBar';

const ROLES: UserRole[] = ['admin', 'manager', 'sales', 'viewer'];

interface PageProps {
  searchParams: Promise<{ active?: string; role?: string }>;
}

export default async function SettingsUsersPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const me = await getCurrentUser();

  // 既定は「有効のみ」。active=all のときだけ全件表示。
  const activeOnly = sp.active !== 'all';
  const roleFilter = ROLES.includes(sp.role as UserRole) ? (sp.role as UserRole) : undefined;

  const users = await listAllUsers({ activeOnly, role: roleFilter });

  const counts = users.reduce<Record<string, number>>((acc, u) => {
    acc[u.role] = (acc[u.role] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      <InviteUserForm />

      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel="USR"
          iconColor="#04844b"
          viewName="ユーザー一覧"
          totalCount={users.length}
          actions={
            <span className="text-xs text-muted-foreground">
              admin: {counts.admin ?? 0} / manager: {counts.manager ?? 0} / sales:{' '}
              {counts.sales ?? 0} / viewer: {counts.viewer ?? 0}
            </span>
          }
        />

        <PanelFilterBar>
          <Suspense>
            <UsersFilterBar
              initialActive={activeOnly ? 'active' : 'all'}
              initialRole={roleFilter ?? ''}
            />
          </Suspense>
        </PanelFilterBar>

        <Table>
          <TableHeader>
            <TableRow className="bg-secondary/50 hover:bg-secondary/50">
              <TableHead className="h-9">氏名</TableHead>
              <TableHead className="h-9">メール</TableHead>
              <TableHead className="h-9">旧Salesforce ID</TableHead>
              <TableHead className="h-9">権限編集</TableHead>
              <TableHead className="h-9">登録日時</TableHead>
              <TableHead className="h-9">削除</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                  ユーザーが登録されていません
                </TableCell>
              </TableRow>
            ) : (
              users.map((u) => (
                <TableRow key={u.id} className="sf-row-hover">
                  <TableCell className="py-2">
                    <div className="font-medium">{u.full_name ?? '-'}</div>
                    {!u.is_active && (
                      <Badge variant="destructive" className="mt-1">
                        無効
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="py-2 text-sm">{u.email}</TableCell>
                  <TableCell className="py-2 font-mono text-xs">
                    {u.legacy_sf_id ?? '-'}
                  </TableCell>
                  <TableCell className="py-2">
                    <UserRoleEditor
                      userId={u.id}
                      initialRole={u.role}
                      initialActive={u.is_active}
                      isSelf={u.id === me.id}
                    />
                  </TableCell>
                  <TableCell className="py-2 text-xs">
                    {formatDateTime(u.created_at)}
                  </TableCell>
                  <TableCell className="py-2">
                    <UserDeleteButton
                      userId={u.id}
                      userName={u.full_name ?? u.email}
                      isSelf={u.id === me.id}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
