/**
 * 出金管理-親 詳細画面 (CLAUDE.md §5.13)
 *
 * 旧Salesforceの出金管理【親】詳細を踏襲したレイアウト:
 *   - 上部: ハイライト(投資案件/キャンペーン名/元金/利益/元利合計)
 *   - 中央: 2カラムの項目表。右列に償還の計算フィールドを表示
 *       償還総額 = 子の出金額合計
 *       元金残高 = 元金 - 償還総額
 *       元金総額(マイナスは0計算) = max(0, 元金残高)
 *       残償還額 = 元利合計 - 償還総額
 *   - 下部: 出金管理【子】の関連リスト
 * 閲覧は admin/manager/support のみ(RLSでも制限)。
 */

import { HighlightPanel } from '@/components/layout/HighlightPanel';
import { ShareLinkButton } from '@/components/layout/ShareLinkButton';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getCurrentUser } from '@/lib/domain/auth';
import { getChildrenByParent, getWithdrawalParent } from '@/lib/domain/withdrawals';
import { formatDate } from '@/lib/utils/date';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

const ALLOWED_ROLES = new Set(['admin', 'manager', 'support']);

/** ¥1,010,000 / -¥42,634 形式(nullは-) */
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
  const parent = await getWithdrawalParent(id);
  if (!parent) notFound();
  const children = await getChildrenByParent(parent.id);

  // 償還の計算フィールド(決定論的な計算はコードで行う)
  const redeemedTotal = children.reduce((s, c) => s + (c.amount ?? 0), 0); // 償還総額
  const principalBalance = (parent.principal ?? 0) - redeemedTotal; // 元金残高
  const principalBalanceFloor = Math.max(0, principalBalance); // 元金総額(マイナスは0計算)
  const remainingRedemption = (parent.total_amount ?? 0) - redeemedTotal; // 残償還額

  const memberLink = parent.member_id ? (
    <Link href={`/members/${parent.member_id}`} className="text-primary hover:underline">
      {parent.member_name ?? parent.member_id}
    </Link>
  ) : (
    (parent.member_name ?? '-')
  );

  return (
    <div className="space-y-3">
      <Link href="/withdrawal-parents" className="sf-back-link text-xs">
        ← 出金管理-親一覧へ
      </Link>

      {/* ハイライト(旧SF: 投資案件/キャンペーン名/元金/利益/元利合計) */}
      <HighlightPanel
        iconLabel="WDP"
        iconColor="#e05a5a"
        objectLabel="出金管理【親】"
        recordName={parent.id}
        recordSubName={parent.member_name ?? undefined}
        facts={[
          { label: '投資案件', value: parent.project_name ?? '-' },
          { label: 'キャンペーン名', value: parent.campaign ?? '-' },
          { label: '元金', value: yen(parent.principal) },
          { label: '利益', value: yen(parent.profit) },
          { label: '元利合計', value: yen(parent.total_amount) },
        ]}
        actions={<ShareLinkButton />}
      />

      {/* 詳細(2カラム項目表)。右列は金額と償還の計算フィールド。 */}
      <Card className="p-4">
        <dl className="grid gap-x-8 md:grid-cols-2">
          <div>
            <DetailRow label="出金管理【親】名">{parent.id}</DetailRow>
            <DetailRow label="顧客情報">{memberLink}</DetailRow>
            <DetailRow label="会員ID">
              {parent.member_id ? (
                <Link
                  href={`/members/${parent.member_id}`}
                  className="text-primary hover:underline"
                >
                  {parent.member_id}
                </Link>
              ) : (
                '-'
              )}
            </DetailRow>
            <DetailRow label="投資案件">{parent.project_name ?? '-'}</DetailRow>
            <DetailRow label="キャンペーン名">{parent.campaign ?? '-'}</DetailRow>
            <DetailRow label="作成日">{formatDate(parent.created_at)}</DetailRow>
          </div>
          <div>
            <DetailRow label="元金">{yen(parent.principal)}</DetailRow>
            <DetailRow label="利益">{yen(parent.profit)}</DetailRow>
            <DetailRow label="元利合計(取り込み用)">{yen(parent.total_amount)}</DetailRow>
            <DetailRow label="償還総額">{yen(redeemedTotal)}</DetailRow>
            <DetailRow label="元金残高(元金 - 償還総額)">
              <span className={principalBalance < 0 ? 'text-destructive' : undefined}>
                {yen(principalBalance)}
              </span>
            </DetailRow>
            <DetailRow label="元金総額(マイナスは0計算)">{yen(principalBalanceFloor)}</DetailRow>
            <DetailRow label="残償還額">{yen(remainingRedemption)}</DetailRow>
            <DetailRow label="最終更新日">{formatDate(parent.updated_at)}</DetailRow>
          </div>
        </dl>
      </Card>

      {/* 出金管理【子】関連リスト(旧SF: 名/投資案件/キャンペーン名/出金額/出金日/作成日) */}
      <Card className="overflow-hidden p-0 shadow-sm">
        <CardHeader className="border-b py-3">
          <CardTitle className="text-sm">
            出金管理【子】({children.length.toLocaleString()})
          </CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50 hover:bg-gray-50">
              <TableHead className="h-9">出金管理【子】名</TableHead>
              <TableHead className="h-9">投資案件</TableHead>
              <TableHead className="h-9">キャンペーン名</TableHead>
              <TableHead className="h-9 text-right">出金額</TableHead>
              <TableHead className="h-9">出金日</TableHead>
              <TableHead className="h-9">作成日</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {children.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
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
                    {c.project_name ?? '-'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap py-2 text-sm">
                    {c.campaign ?? '-'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap py-2 text-right text-sm tabular-nums">
                    {yen(c.amount)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap py-2 text-sm">
                    {c.withdrawal_date ? formatDate(c.withdrawal_date) : '-'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap py-2 text-sm">
                    {formatDate(c.created_at)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {/* すべて表示: 子一覧を親Noで絞り込んで開く */}
        <div className="border-t px-4 py-2 text-center">
          <Link
            href={`/withdrawal-children?q=${encodeURIComponent(parent.id)}`}
            className="sf-link text-sm"
          >
            すべて表示
          </Link>
        </div>
      </Card>
    </div>
  );
}
