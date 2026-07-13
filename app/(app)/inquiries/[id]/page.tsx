/**
 * 問合せ詳細画面(仕様書 §8.1)
 * - 基本情報
 * - フォーム固有項目(JSONB extra)
 * - 会員化アクション
 */

import { renderInquiryHighlightFieldValue } from '@/components/inquiries/InquiryHighlightFieldValue';
import { HighlightPanel } from '@/components/layout/HighlightPanel';
import { ShareLinkButton } from '@/components/layout/ShareLinkButton';
import { DynamicDetailFields } from '@/components/objects/DynamicDetailFields';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getInquiry } from '@/lib/domain/inquiries';
import { getVisibleFields } from '@/lib/domain/object_metadata';
import { formatDateTime } from '@/lib/utils/date';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConvertButton } from './ConvertButton';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function InquiryDetailPage({ params }: PageProps) {
  const { id } = await params;
  const [inquiry, detailFields, highlightFields] = await Promise.all([
    getInquiry(id),
    // オブジェクト管理 (/settings/objects/inquiries) で「詳細」表示ONのフィールドのみ
    getVisibleFields('inquiries', 'detail'),
    // レイアウトエディタの「ハイライト」設定(is_visible_highlight 順)
    getVisibleFields('inquiries', 'highlight'),
  ]);
  if (!inquiry) notFound();

  // ハイライト設定があればそれで組み立て、無ければ従来の既定4項目にフォールバック
  const highlightFacts =
    highlightFields.length > 0
      ? highlightFields.map((f) => ({
          label: f.label ?? f.field_name,
          value: renderInquiryHighlightFieldValue(f, inquiry),
        }))
      : [
          {
            label: 'ステータス',
            value: inquiry.member ? (
              <Badge variant="success">会員化済</Badge>
            ) : (
              <Badge variant="destructive">未対応</Badge>
            ),
          },
          {
            label: 'フォーム名',
            value: inquiry.form?.name ?? '-',
          },
          {
            label: '登録日時',
            value: formatDateTime(inquiry.registered_at) || '-',
          },
          {
            label: '会員ID',
            value: inquiry.member ? (
              <Link href={`/members/${inquiry.member.id}`} className="text-primary hover:underline">
                {inquiry.member.id}
              </Link>
            ) : (
              '-'
            ),
          },
        ];

  return (
    <div className="space-y-3">
      {/* パンくず(戻るリンク) */}
      <Link href="/inquiries" className="sf-back-link text-xs">
        ← 問合せ一覧へ
      </Link>

      {/* Highlight Panel: レイアウトエディタの「ハイライト」設定に従う(未設定時は既定4項目)。
          未会員化の場合のみ会員化ボタンをアクションに出す。 */}
      <HighlightPanel
        iconLabel="INQ"
        iconColor="#fea130"
        objectLabel="問合せ"
        recordName={inquiry.name ?? '(氏名なし)'}
        recordSubName={inquiry.id}
        facts={highlightFacts}
        actions={
          <>
            <ShareLinkButton />
            {inquiry.member ? null : (
              <ConvertButton inquiryId={inquiry.id} defaultName={inquiry.name} />
            )}
          </>
        }
      />

      {/* 基本情報(フルワイド)。氏名/会員IDは会員が紐付いていれば会員詳細へのリンクにする。 */}
      <Card>
        <CardHeader className="border-b py-3">
          <CardTitle className="text-sm">基本情報</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          {/*
            会員詳細と同じ動的レンダリング方式。
            オブジェクト管理 (/settings/objects/inquiries) の「詳細」表示ON
            フィールドのみ、セクションと並び順を反映して表示する。
          */}
          <DynamicDetailFields
            record={inquiry as unknown as Record<string, unknown>}
            fields={detailFields}
            columns={4}
            fieldOverrides={{
              // フォーム: 生ID(form_id)ではなくフォーム名を表示(ハイライトと統一)
              form_id: inquiry.form?.name ?? '-',
              name: inquiry.member ? (
                <Link
                  href={`/members/${inquiry.member.id}`}
                  className="text-primary hover:underline"
                >
                  {inquiry.name ?? inquiry.member.name ?? '-'}
                </Link>
              ) : (
                (inquiry.name ?? '-')
              ),
              member_id: inquiry.member ? (
                <Link
                  href={`/members/${inquiry.member.id}`}
                  className="text-primary hover:underline"
                >
                  {inquiry.member.id}
                </Link>
              ) : (
                (inquiry.member_id ?? '-')
              ),
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
