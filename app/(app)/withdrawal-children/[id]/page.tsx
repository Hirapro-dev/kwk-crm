/**
 * 出金管理-子 詳細画面 (CLAUDE.md §5.13)
 * - 基本情報(オブジェクト管理の詳細設定に従う / 4列)
 * 閲覧は admin/manager/support のみ(RLSでも制限)。
 */

import { HighlightPanel } from '@/components/layout/HighlightPanel';
import { DynamicDetailFields } from '@/components/objects/DynamicDetailFields';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/domain/auth';
import { getVisibleFields } from '@/lib/domain/object_metadata';
import { getWithdrawalChild } from '@/lib/domain/withdrawals';
import { formatDate } from '@/lib/utils/date';
import Link from 'next/link';
import { notFound } from 'next/navigation';

const ALLOWED_ROLES = new Set(['admin', 'manager', 'support']);

export default async function WithdrawalChildDetailPage({
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
  const [child, detailFields] = await Promise.all([
    getWithdrawalChild(id),
    getVisibleFields('withdrawal_children', 'detail'),
  ]);
  if (!child) notFound();

  return (
    <div className="space-y-3">
      <Link href="/withdrawal-children" className="sf-back-link text-xs">
        ← 出金管理-子一覧へ
      </Link>

      <HighlightPanel
        iconLabel="WDC"
        iconColor="#e08a5a"
        objectLabel="出金管理-子"
        recordName={child.member_name ?? '(会員氏名なし)'}
        recordSubName={child.id}
        facts={[
          { label: '投資案件', value: child.project_name ?? '-' },
          {
            label: '出金日',
            value: child.withdrawal_date ? formatDate(child.withdrawal_date) : '-',
          },
          { label: '出金額', value: child.amount === null ? '-' : child.amount.toLocaleString() },
          {
            label: '償還-親No',
            value: child.parent_id ? (
              <Link
                href={`/withdrawal-parents/${child.parent_id}`}
                className="text-primary hover:underline"
              >
                {child.parent_no ?? child.parent_id}
              </Link>
            ) : (
              (child.parent_no ?? '-')
            ),
          },
        ]}
      />

      {/* 基本情報(フルワイド4列)。親No/会員は各詳細へのリンクにする。 */}
      <Card>
        <CardHeader className="border-b py-3">
          <CardTitle className="text-sm">基本情報</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <DynamicDetailFields
            record={child as unknown as Record<string, unknown>}
            fields={detailFields}
            columns={4}
            fieldOverrides={{
              parent_no: child.parent_id ? (
                <Link
                  href={`/withdrawal-parents/${child.parent_id}`}
                  className="text-primary hover:underline"
                >
                  {child.parent_no ?? child.parent_id}
                </Link>
              ) : (
                (child.parent_no ?? '-')
              ),
              member_id: child.member_id ? (
                <Link href={`/members/${child.member_id}`} className="text-primary hover:underline">
                  {child.member_id}
                </Link>
              ) : (
                '-'
              ),
              member_name: child.member_id ? (
                <Link href={`/members/${child.member_id}`} className="text-primary hover:underline">
                  {child.member_name ?? '-'}
                </Link>
              ) : (
                (child.member_name ?? '-')
              ),
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
