/**
 * /settings/users — ユーザー管理 (管理者用)
 *
 * /admin/users の機能 + 新規招待ボタンを統合した版。
 * /settings 配下のため、layout.tsx で admin チェック済 (二重チェックなし)。
 */

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
import type { UserRole } from '@/lib/domain/types';
import { listAllUsers } from '@/lib/domain/users_admin';
import Link from 'next/link';
import { Suspense } from 'react';
import { InviteUserForm } from './InviteUserForm';
import { UsersFilterBar } from './UsersFilterBar';

const ROLES: UserRole[] = ['admin', 'manager', 'sales', 'viewer'];

interface PageProps {
  searchParams: Promise<{ active?: string; role?: string }>;
}

export default async function SettingsUsersPage({ searchParams }: PageProps) {
  const sp = await searchParams;

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
            <TableRow className="bg-gray-50 hover:bg-gray-50">
              <TableHead className="h-9">名前</TableHead>
              <TableHead className="h-9">メールアドレス</TableHead>
              <TableHead className="h-9">権限</TableHead>
              <TableHead className="h-9">有効</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                  ユーザーが登録されていません
                </TableCell>
              </TableRow>
            ) : (
              users.map((u) => (
                <TableRow key={u.id} className="sf-row-hover">
                  <TableCell className="py-2">
                    <Link
                      href={`/settings/users/${u.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {u.full_name ?? '(氏名未設定)'}
                    </Link>
                  </TableCell>
                  <TableCell className="py-2 text-sm">{u.email}</TableCell>
                  <TableCell className="py-2">
                    <Badge variant="outline">{u.role}</Badge>
                  </TableCell>
                  <TableCell className="py-2">
                    {u.is_active ? (
                      <Badge variant="success">有効</Badge>
                    ) : (
                      <Badge variant="destructive">無効</Badge>
                    )}
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
