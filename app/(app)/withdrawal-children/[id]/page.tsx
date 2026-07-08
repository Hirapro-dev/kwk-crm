/**
 * 出金管理-子 詳細画面 (CLAUDE.md §5.13)
 *
 * 旧Salesforceの出金管理【子】詳細を踏襲した2カラムの項目表レイアウト:
 *   左: 出金管理【子】名 / 出金管理【親】/ 会員ID / 顧客情報 / 作成日
 *   右: 投資案件 / キャンペーン名 / 出金額 / 出金日 / 最終更新日
 * 閲覧は admin/manager/support のみ(RLSでも制限)。
 */

import { HighlightPanel } from '@/components/layout/HighlightPanel';
import { Card } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/domain/auth';
import { getWithdrawalChild } from '@/lib/domain/withdrawals';
import { formatDate } from '@/lib/utils/date';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

const ALLOWED_ROLES = new Set(['admin', 'manager', 'support']);

/** ¥164,125 形式(nullは-) */
function yen(v: number | null | undefined): string {
  if (v === null || v === undefined) return '-';
  const n = Number(v);
  return n < 0 ? `-¥${Math.abs(n).toLocaleString()}` : `¥${n.toLocaleString()}`;
}

/** 項目表の1行(ラベル + 値)。旧SFの詳細レイアウト風。 */
function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[11rem_1fr] items-start gap-2 border-b py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

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
  const child = await getWithdrawalChild(id);
  if (!child) notFound();

  const parentLink = child.parent_id ? (
    <Link href={`/withdrawal-parents/${child.parent_id}`} className="text-primary hover:underline">
      {child.parent_no ?? child.parent_id}
    </Link>
  ) : (
    (child.parent_no ?? '-')
  );

  return (
    <div className="space-y-3">
      <Link href="/withdrawal-children" className="sf-back-link text-xs">
        ← 出金管理-子一覧へ
      </Link>

      <HighlightPanel
        iconLabel="WDC"
        iconColor="#e08a5a"
        objectLabel="出金管理【子】"
        recordName={child.id}
        recordSubName={child.member_name ?? undefined}
        facts={[
          { label: '投資案件', value: child.project_name ?? '-' },
          { label: '出金額', value: yen(child.amount) },
          {
            label: '出金日',
            value: child.withdrawal_date ? formatDate(child.withdrawal_date) : '-',
          },
          { label: '出金管理【親】', value: parentLink },
        ]}
      />

      {/* 詳細(2カラム項目表)。旧SFの並びを踏襲。 */}
      <Card className="p-4">
        <dl className="grid gap-x-8 md:grid-cols-2">
          <div>
            <DetailRow label="出金管理【子】名">{child.id}</DetailRow>
            <DetailRow label="出金管理【親】">{parentLink}</DetailRow>
            <DetailRow label="会員ID">
              {child.member_id ? (
                <Link href={`/members/${child.member_id}`} className="text-primary hover:underline">
                  {child.member_id}
                </Link>
              ) : (
                '-'
              )}
            </DetailRow>
            <DetailRow label="顧客情報">
              {child.member_id ? (
                <Link href={`/members/${child.member_id}`} className="text-primary hover:underline">
                  {child.member_name ?? child.member_id}
                </Link>
              ) : (
                (child.member_name ?? '-')
              )}
            </DetailRow>
            <DetailRow label="作成日">{formatDate(child.created_at)}</DetailRow>
          </div>
          <div>
            <DetailRow label="投資案件">{child.project_name ?? '-'}</DetailRow>
            <DetailRow label="キャンペーン名">{child.campaign ?? '-'}</DetailRow>
            <DetailRow label="出金額">{yen(child.amount)}</DetailRow>
            <DetailRow label="出金日">
              {child.withdrawal_date ? formatDate(child.withdrawal_date) : '-'}
            </DetailRow>
            <DetailRow label="最終更新日">{formatDate(child.updated_at)}</DetailRow>
          </div>
        </dl>
      </Card>
    </div>
  );
}
