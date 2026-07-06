/**
 * 定期連絡者 会員一覧 /members/regular-contacts
 * ログインユーザー(+同名アカウント)が定期連絡担当の会員を全件表示する。
 */

import { PanelHeader } from '@/components/layout/PanelHeader';
import { PhoneLink } from '@/components/layout/PhoneLink';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getCurrentUser } from '@/lib/domain/auth';
import { getAllMyRegularContacts } from '@/lib/domain/dashboard';
import Link from 'next/link';

export const metadata = { title: '定期連絡者 会員一覧' };

export default async function RegularContactsPage() {
  const me = await getCurrentUser();
  const members = await getAllMyRegularContacts(me.id);

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel="MEM"
          iconColor="#1589ee"
          viewName="定期連絡者 会員一覧"
          totalCount={members.length}
          actions={
            <Link href="/members" className="text-xs text-muted-foreground hover:underline">
              ← 会員一覧へ
            </Link>
          }
        />
      </Card>

      {members.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            定期連絡担当の会員はいません
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-8 whitespace-nowrap text-xs">会員ID</TableHead>
                  <TableHead className="h-8 whitespace-nowrap text-xs">会員名</TableHead>
                  <TableHead className="h-8 whitespace-nowrap text-xs">電話</TableHead>
                  <TableHead className="h-8 whitespace-nowrap text-xs">住所</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.id} className="sf-row-hover">
                    <TableCell className="whitespace-nowrap py-2 font-mono text-xs">
                      <Link href={`/members/${m.id}`} className="text-primary hover:underline">
                        {m.id}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-2 text-sm">
                      {m.name ?? '-'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-2 text-sm">
                      {m.phone1 ? <PhoneLink value={m.phone1} /> : '-'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-2 text-sm">
                      {m.address ?? '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}
