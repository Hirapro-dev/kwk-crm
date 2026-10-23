/**
 * 旧社債管理 詳細画面(CLAUDE.md §5.13c)
 *
 * 上部: ハイライト(社債名 / 入金額 / 償還対象月 / 償還金額 / 今回の結果)と「編集」
 * 中央: 2 カラムの項目表(左: 関係先と社債の情報、右: 金額と継続条件)。前の期 / 次の期へのリンク
 * 下部: 継続した行で次の期がまだ無ければ「次の期を作成」(2026-10-23。migration 130)
 * 閲覧・編集は admin のみ(RLS でも制限)。
 */

import { HighlightPanel } from '@/components/layout/HighlightPanel';
import { ShareLinkButton } from '@/components/layout/ShareLinkButton';
import { LegacyBondContinuePanel } from '@/components/legacy_bonds/LegacyBondContinuePanel';
import { LegacyBondEditDialog } from '@/components/legacy_bonds/LegacyBondEditDialog';
import { Card } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/domain/auth';
import { getLegacyBond, getPrevLegacyBondId } from '@/lib/domain/legacy_bonds';
import { isContinueResult } from '@/lib/domain/legacy_bonds_calc';
import { formatDate } from '@/lib/utils/date';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

/** ¥1,010,000 / -¥42,634 形式(null は -) */
function yen(v: number | null | undefined): string {
  if (v === null || v === undefined) return '-';
  const n = Number(v);
  return n < 0 ? `-¥${Math.abs(n).toLocaleString()}` : `¥${n.toLocaleString()}`;
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[11rem_1fr] items-start gap-2 border-b py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export default async function LegacyBondDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await getCurrentUser();
  if (me.role !== 'admin') {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        このページを表示する権限がありません。
      </p>
    );
  }
  const { id } = await params;
  const [bond, prevId] = await Promise.all([getLegacyBond(id), getPrevLegacyBondId(id)]);
  if (!bond) notFound();
  const bondLink = (target: string | null) =>
    target ? (
      <Link href={`/legacy-bonds/${target}`} className="text-primary hover:underline">
        {target}
      </Link>
    ) : (
      '-'
    );

  const memberLink = bond.member_id ? (
    <Link href={`/members/${bond.member_id}`} className="text-primary hover:underline">
      {bond.member_name ?? bond.member_id}
    </Link>
  ) : (
    (bond.member_name ?? '-')
  );
  const applicationLink = bond.application_id ? (
    <Link href={`/applications/${bond.application_id}`} className="text-primary hover:underline">
      {bond.application_no ?? bond.application_id}
    </Link>
  ) : (
    (bond.application_no ?? '-')
  );

  return (
    <div className="space-y-3">
      <Link href="/legacy-bonds" className="sf-back-link text-xs">
        ← 旧社債管理一覧へ
      </Link>

      <HighlightPanel
        iconLabel="BND"
        iconColor="#8a5ae0"
        objectLabel="旧社債管理"
        recordName={bond.id}
        recordSubName={bond.member_name ?? undefined}
        facts={[
          { label: '社債名', value: bond.bond_name ?? '-' },
          { label: '入金額', value: yen(bond.payment_amount) },
          { label: '償還対象月', value: bond.redemption_month ?? '-' },
          { label: '償還金額', value: yen(bond.redemption_amount) },
          { label: '今回の結果', value: bond.result ?? '-' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <LegacyBondEditDialog bond={bond} />
            <ShareLinkButton />
          </div>
        }
      />

      <Card className="p-4">
        <dl className="grid gap-x-8 md:grid-cols-2">
          <div>
            <DetailRow label="旧社債管理ID">{bond.id}</DetailRow>
            <DetailRow label="顧客情報">{memberLink}</DetailRow>
            <DetailRow label="会員ID">
              {bond.member_id ? (
                <Link href={`/members/${bond.member_id}`} className="text-primary hover:underline">
                  {bond.member_id}
                </Link>
              ) : (
                '-'
              )}
            </DetailRow>
            <DetailRow label="申込ID">{applicationLink}</DetailRow>
            <DetailRow label="案件">
              {bond.project_name ?? '-'}
              {bond.project_id ? (
                <span className="ml-1 text-xs text-muted-foreground">({bond.project_id})</span>
              ) : null}
            </DetailRow>
            <DetailRow label="社債名">{bond.bond_name ?? '-'}</DetailRow>
            <DetailRow label="今回の結果">{bond.result ?? '-'}</DetailRow>
            <DetailRow label="契約書送付日">
              {bond.contract_sent_date ? formatDate(bond.contract_sent_date) : '-'}
            </DetailRow>
            <DetailRow label="銀行情報">
              <span className="whitespace-pre-wrap">{bond.bank_info ?? '-'}</span>
            </DetailRow>
          </div>
          <div>
            <DetailRow label="入金額">{yen(bond.payment_amount)}</DetailRow>
            <DetailRow label="償還対象月">{bond.redemption_month ?? '-'}</DetailRow>
            <DetailRow label="償還金額">{yen(bond.redemption_amount)}</DetailRow>
            <DetailRow label="前回継続元金">{yen(bond.prev_principal)}</DetailRow>
            <DetailRow label="前回継続年数">
              {bond.prev_years != null ? `${bond.prev_years} 年` : '-'}
            </DetailRow>
            <DetailRow label="前回継続利息（年）">
              {bond.prev_interest_rate != null ? `${bond.prev_interest_rate} %` : '-'}
            </DetailRow>
            <DetailRow label="利息">{yen(bond.interest)}</DetailRow>
            <DetailRow label="源泉税">
              {yen(bond.withholding_tax)}
              {bond.withholding_exempt && (
                <span className="ml-2 text-xs text-muted-foreground">
                  源泉徴収なし(海外法人名義)
                </span>
              )}
            </DetailRow>
            <DetailRow label="一部継続金額">{yen(bond.partial_continue_amount)}</DetailRow>
            <DetailRow label="一部償還金額">{yen(bond.partial_redemption_amount)}</DetailRow>
            <DetailRow label="前の期">{bondLink(prevId)}</DetailRow>
            <DetailRow label="次の期">{bondLink(bond.next_bond_id)}</DetailRow>
            <DetailRow label="作成日">{formatDate(bond.created_at)}</DetailRow>
            <DetailRow label="最終更新日">{formatDate(bond.updated_at)}</DetailRow>
          </div>
        </dl>
      </Card>

      {isContinueResult(bond.result) && !bond.next_bond_id && (
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold">次の期を作成</h2>
          <p className="mb-2 text-xs text-muted-foreground">
            今回の結果が「{bond.result}
            」です。継続年数を選ぶと、次の期の行(元金・満期・利率・金額を自動計算)を作成します。
          </p>
          <LegacyBondContinuePanel bond={bond} />
        </Card>
      )}
    </div>
  );
}
