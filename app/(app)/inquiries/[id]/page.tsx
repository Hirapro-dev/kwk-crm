/**
 * 問合せ詳細画面(仕様書 §8.1)
 * - 基本情報
 * - フォーム固有項目(JSONB extra)
 * - 会員化アクション
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HighlightPanel } from '@/components/layout/HighlightPanel';
import { DynamicDetailFields } from '@/components/objects/DynamicDetailFields';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getInquiry } from '@/lib/domain/inquiries';
import { getVisibleFields } from '@/lib/domain/object_metadata';
import { formatDateTime } from '@/lib/utils/date';
import { ConvertButton } from './ConvertButton';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function InquiryDetailPage({ params }: PageProps) {
  const { id } = await params;
  const [inquiry, detailFields] = await Promise.all([
    getInquiry(id),
    // オブジェクト管理 (/settings/objects/inquiries) で「詳細」表示ONのフィールドのみ
    getVisibleFields('inquiries', 'detail'),
  ]);
  if (!inquiry) notFound();

  return (
    <div className="space-y-3">
      {/* パンくず(戻るリンク) */}
      <Link href="/inquiries" className="sf-back-link text-xs">
        ← 問合せ一覧へ
      </Link>

      {/* Highlight Panel: 会員詳細と同じ Salesforce 風カードヘッダー */}
      <HighlightPanel
        iconLabel="INQ"
        iconColor="#fea130"
        objectLabel="問合せ"
        recordName={inquiry.name ?? '(氏名なし)'}
        recordSubName={inquiry.id}
        facts={[
          {
            label: 'ステータス',
            value: inquiry.member ? (
              <Badge variant="success">会員化済</Badge>
            ) : (
              <Badge variant="destructive">未対応</Badge>
            ),
          },
          {
            label: 'フォーム',
            value: inquiry.form?.name ?? '-',
          },
          {
            label: '登録日時',
            value: formatDateTime(inquiry.registered_at) || '-',
          },
          {
            label: '会員',
            value: inquiry.member ? (
              <Link
                href={`/members/${inquiry.member.id}`}
                className="text-primary hover:underline"
              >
                {inquiry.member.id}
              </Link>
            ) : (
              '-'
            ),
          },
        ]}
      />

      {/* 左: 基本情報, 右: 会員化 + フォーム固有項目 を 1:1 で並べる */}
      <div className="grid gap-4 lg:grid-cols-2">
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
            />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>会員化</CardTitle>
            </CardHeader>
            <CardContent>
              {inquiry.member ? (
                <p className="text-sm text-muted-foreground">
                  既に会員化済みです:
                  <Link
                    href={`/members/${inquiry.member.id}`}
                    className="ml-1 text-primary hover:underline"
                  >
                    {inquiry.member.id}
                  </Link>
                </p>
              ) : (
                <ConvertButton inquiryId={inquiry.id} defaultName={inquiry.name} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>フォーム固有項目</CardTitle>
            </CardHeader>
            <CardContent>
              {Object.keys(inquiry.extra ?? {}).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  追加項目はありません(共通項目のみ)
                </p>
              ) : (
                <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
                  {Object.entries(inquiry.extra)
                    .filter(([k]) => !k.startsWith('_'))
                    .map(([k, v]) => (
                      <div key={k} className="border-b pb-1">
                        <dt className="text-xs text-muted-foreground">{k}</dt>
                        <dd className="break-all">{formatExtraValue(v)}</dd>
                      </div>
                    ))}
                </dl>
              )}

              {Object.entries(inquiry.extra ?? {}).some(([k]) => k.startsWith('_')) && (
                <details className="mt-4 text-xs text-muted-foreground">
                  <summary className="cursor-pointer">メタ情報(移行時の証跡)</summary>
                  <pre className="mt-2 overflow-auto rounded bg-muted p-2 text-xs">
                    {JSON.stringify(
                      Object.fromEntries(
                        Object.entries(inquiry.extra).filter(([k]) => k.startsWith('_')),
                      ),
                      null,
                      2,
                    )}
                  </pre>
                </details>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function formatExtraValue(v: unknown): string {
  if (v === null || v === undefined) return '-';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

