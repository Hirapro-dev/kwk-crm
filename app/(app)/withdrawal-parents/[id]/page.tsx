/**
 * 出金管理-親 詳細画面 (CLAUDE.md §5.13)
 * - 基本情報(オブジェクト管理の詳細設定に従う / 4列)
 * - この償還枠に紐づく出金(子)の一覧
 * 閲覧は admin/manager/support のみ(RLSでも制限)。
 */

import { HighlightPanel } from '@/components/layout/HighlightPanel';
import { DynamicDetailFields } from '@/components/objects/DynamicDetailFields';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getCurrentUser } from '@/lib/domain/auth';
import { getVisibleFields } from '@/lib/domain/object_metadata';
import { getChildrenByParent, getWithdrawalParent } from '@/lib/domain/withdrawals';
import { formatDate } from '@/lib/utils/date';
import Link from 'next/link';
import { notFound } from 'next/navigation';

const ALLOWED_ROLES = new Set(['admin', 'manager', 'support']);

function yen(v: number | null): string {
  return v === null || v === undefined ? '-' : Number(v).toLocaleString();
}

export default async function WithdrawalParentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await getCurrentUser();
  if (!ALLOWED_ROLES.has(me.role)) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        このページを表示する権限がありません。
      </p>
    );
  }

  const { id } = await params;
  const [parent, detailFields] = await Promise.all([
    getWithdrawalParent(id),
    getVisibleFields('withdrawal_parents', 'detail'),
  ]);
  if (!parent) notFound();
  const children = await getChildrenByParent(parent.id);
  const withdrawnTotal = children.reduce((s, c) => s + (c.amount ?? 0), 0);

  return (
    <div className="space-y-3">
      <Link href="/withdrawal-parents" className="sf-back-link text-xs">
        ← 出金管理-親一覧へ
      </Link>

      <HighlightPanel
        iconLabel="WDP"
        iconColor="#e05a5a"
        objectLabel="出金管理-親"
        recordName={parent.member_name ?? '(会員氏名なし)'}
        recordSubName={parent.id}
        facts={[
          { label: '投資案件', value: parent.project_name ?? '-' },
          { label: '元金', value: yen(parent.principal) },
          { label: '元利合計', value: yen(parent.total_amount) },
          {
            label: '会員',
            value: parent.member_id ? (
              <Link href={`/members/${parent.member_id}`} className="text-primary hover:underline">
                {parent.member_name ?? parent.member_id}
              </Link>
            ) : (
              (parent.member_name ?? '-')
            ),
          },
        ]}
      />

      {/* 基本情報(フルワイド4列)。会員は会員詳細へのリンクにする。 */}
      <Card>
        <CardHeader className="border-b py-3">
          <CardTitle className="text-sm">基本情報</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <DynamicDetailFields
            record={parent as unknown as Record<string, unknown>}
            fields={detailFields}
            columns={4}
            fieldOverrides={{
              member_id: parent.member_id ? (
                <Link
                  href={`/members/${parent.member_id}`}
                  className="text-primary hover:underline"
                >
                  {parent.member_id}
                </Link>
              ) : (
                '-'
              ),
              member_name: parent.member_id ? (
                <Link
                  href={`/members/${parent.member_id}`}
                  className="text-primary hover:underline"
                >
                  {parent.member_name ?? '-'}
                </Link>
              ) : (
                (parent.member_name ?? '-')
              ),
            }}
          />
        </CardContent>
      </Card>

      {/* この償還枠に紐づく出金(子)一覧 */}
      <Card className="overflow-hidden p-0 shadow-sm">
        <CardHeader className="border-b py-3">
          <CardTitle className="text-sm">
            出金履歴(子) {children.length.toLocaleString()} 件 ／ 出金合計{' '}
            {withdrawnTotal.toLocaleString()}
          </CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50 hover:bg-gray-50">
              <TableHead className="h-9">償還-子No</TableHead>
              <TableHead className="h-9">出金日</TableHead>
              <TableHead className="h-9 text-right">出金額</TableHead>
              <TableHead className="h-9">キャンペーン名</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {children.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                  出金履歴がありません
                </TableCell>
              </TableRow>
            ) : (
              children.map((c) => (
                <TableRow key={c.id} className="sf-row-hover">
                  <TableCell className="whitespace-nowrap py-2 text-sm">
                    <Link href={`/withdrawal-children/${c.id}`} className="sf-link font-medium">
                      {c.id}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap py-2 text-sm">
                    {c.withdrawal_date ? formatDate(c.withdrawal_date) : '-'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap py-2 text-right text-sm tabular-nums">
                    {yen(c.amount)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap py-2 text-sm">
                    {c.campaign ?? '-'}
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
