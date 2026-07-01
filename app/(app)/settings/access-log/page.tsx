/**
 * アクセスログ / アクティブログ (admin のみ。/settings 配下なので layout で admin 制御済み)
 * ユーザーごとの最終ログイン日時・有効状態を一覧表示する。
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
import { listUserAccessLog } from '@/lib/domain/access_log';
import { formatDateTime } from '@/lib/utils/date';
import { AccessLogFilterBar } from './AccessLogFilterBar';

export const metadata = { title: 'アクセスログ' };
// 最終ログインを常に最新で表示するため動的レンダリング
export const dynamic = 'force-dynamic';

const ROLE_LABEL: Record<string, string> = {
  admin: '管理者',
  manager: 'マネージャ',
  sales: '営業',
  support: 'サポート',
  viewer: '閲覧',
};

export default async function AccessLogPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  // デフォルトは有効のみ表示
  const status = sp.status === 'inactive' || sp.status === 'all' ? sp.status : 'active';

  const all = await listUserAccessLog();
  const rows =
    status === 'all' ? all : all.filter((r) => (status === 'active' ? r.is_active : !r.is_active));
  const loggedIn = rows.filter((r) => r.last_sign_in_at).length;

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel="LOG"
          iconColor="#00C896"
          viewName="アクセスログ / アクティブ状況"
          totalCount={rows.length}
          actions={
            <span className="text-xs text-muted-foreground">
              ログイン実績あり {loggedIn} / {rows.length} 名
            </span>
          }
        />
        <div className="px-4 py-2 text-xs text-muted-foreground">
          各ユーザーの最終ログイン日時です（Supabase
          Auth基準・最新ログイン順）。「無効」ユーザーはログインできません。
        </div>
        <PanelFilterBar>
          <AccessLogFilterBar initialStatus={status} />
        </PanelFilterBar>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50 hover:bg-gray-50">
                <TableHead className="h-9 whitespace-nowrap">ユーザー</TableHead>
                <TableHead className="h-9 whitespace-nowrap">メール</TableHead>
                <TableHead className="h-9 whitespace-nowrap">ロール</TableHead>
                <TableHead className="h-9 whitespace-nowrap">状態</TableHead>
                <TableHead className="h-9 whitespace-nowrap">最終ログイン</TableHead>
                <TableHead className="h-9 whitespace-nowrap">登録日時</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    データがありません
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id} className="sf-row-hover">
                    <TableCell className="whitespace-nowrap py-2 font-medium">
                      {r.full_name ?? '-'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-2 text-sm">{r.email}</TableCell>
                    <TableCell className="whitespace-nowrap py-2 text-sm">
                      {ROLE_LABEL[r.role] ?? r.role}
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-2">
                      {r.is_active ? (
                        <Badge variant="outline">有効</Badge>
                      ) : (
                        <Badge variant="destructive">無効</Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-2 text-sm">
                      {r.last_sign_in_at ? (
                        formatDateTime(r.last_sign_in_at)
                      ) : (
                        <span className="text-muted-foreground">未ログイン</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-2 text-xs text-muted-foreground">
                      {r.created_at ? formatDateTime(r.created_at) : '-'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
