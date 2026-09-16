/**
 * LP 詳細画面(CLAUDE.md §5.17)
 * 取込専用オブジェクトのため編集は無し。会員が紐付いていれば会員詳細へのリンクを出す。
 */

import { HighlightPanel } from '@/components/layout/HighlightPanel';
import { ShareLinkButton } from '@/components/layout/ShareLinkButton';
import { Card } from '@/components/ui/card';
import { getLpEntry } from '@/lib/domain/lp';
import { formatDateTime } from '@/lib/utils/date';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[11rem_1fr] items-start gap-2 border-b py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-all">{children}</dd>
    </div>
  );
}

export default async function LpDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lp = await getLpEntry(id);
  if (!lp) notFound();

  const memberLink = lp.member_id ? (
    <Link href={`/members/${lp.member_id}`} className="text-primary hover:underline">
      {lp.member?.name ? `${lp.member.name}(${lp.member_id})` : lp.member_id}
    </Link>
  ) : (
    '-'
  );

  return (
    <div className="space-y-3">
      <Link href="/lp" className="sf-back-link text-xs">
        ← LP 一覧へ
      </Link>
      <HighlightPanel
        iconLabel="LP"
        iconColor="#8b5cf6"
        objectLabel="LP"
        recordName={lp.name ?? lp.email ?? lp.id}
        recordSubName={lp.id}
        facts={[
          { label: '登録日時', value: formatDateTime(lp.registered_at) || '-' },
          { label: 'フォーム', value: lp.form_name ?? '-' },
          { label: 'メール', value: lp.email ?? '-' },
          { label: '会員', value: memberLink },
        ]}
        actions={<ShareLinkButton />}
      />
      <Card className="p-4">
        <dl className="grid gap-x-8 md:grid-cols-2">
          <div>
            <DetailRow label="問合せID">{lp.id}</DetailRow>
            <DetailRow label="フォーム名">{lp.form_name ?? '-'}</DetailRow>
            <DetailRow label="登録日時">{formatDateTime(lp.registered_at) || '-'}</DetailRow>
            <DetailRow label="登録月">{lp.registered_month ?? '-'}</DetailRow>
            <DetailRow label="広告ID">{lp.ad_id ?? '-'}</DetailRow>
          </div>
          <div>
            <DetailRow label="氏名">{lp.name ?? '-'}</DetailRow>
            <DetailRow label="氏名かな">{lp.name_kana ?? '-'}</DetailRow>
            <DetailRow label="メールアドレス">{lp.email ?? '-'}</DetailRow>
            <DetailRow label="会員">{memberLink}</DetailRow>
            <DetailRow label="取込日">{formatDateTime(lp.created_at) || '-'}</DetailRow>
          </div>
        </dl>
      </Card>
    </div>
  );
}
