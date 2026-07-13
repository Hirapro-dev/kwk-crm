/**
 * 申込詳細画面(仕様書 §8.1)
 * - 全項目表示
 * - ステータス / 入出金区分の遷移エディタ
 * - JSONB extra(案件固有項目)
 */

import { renderApplicationHighlightFieldValue } from '@/components/applications/ApplicationHighlightFieldValue';
import { HighlightPanel } from '@/components/layout/HighlightPanel';
import { ShareLinkButton } from '@/components/layout/ShareLinkButton';
import { DynamicDetailFields } from '@/components/objects/DynamicDetailFields';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getApplication } from '@/lib/domain/applications';
import { getVisibleFields } from '@/lib/domain/object_metadata';
import { formatDate } from '@/lib/utils/date';
import Link from 'next/link';
import { notFound } from 'next/navigation';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ApplicationDetailPage({ params }: PageProps) {
  const { id } = await params;
  const [app, detailFields, highlightFields] = await Promise.all([
    getApplication(id),
    // オブジェクト管理 (/settings/objects/applications) で「詳細」表示ONのフィールドのみ
    getVisibleFields('applications', 'detail'),
    // レイアウトエディタの「ハイライト」設定(is_visible_highlight 順)
    getVisibleFields('applications', 'highlight'),
  ]);
  if (!app) notFound();

  // ハイライト設定があればそれで組み立て、無ければ従来の既定4項目にフォールバック
  const highlightFacts =
    highlightFields.length > 0
      ? highlightFields.map((f) => ({
          label: f.label ?? f.field_name,
          value: renderApplicationHighlightFieldValue(f, app),
        }))
      : [
          {
            label: 'ステータス',
            value: app.status ? <Badge>{app.status}</Badge> : '-',
          },
          {
            label: '入金/移動',
            value: app.flow_type ? <Badge variant="outline">{app.flow_type}</Badge> : '-',
          },
          {
            label: '申込日',
            value: formatDate(app.application_date) || '-',
          },
          {
            label: '会員ID',
            value: app.member ? (
              <Link href={`/members/${app.member.id}`} className="text-primary hover:underline">
                {app.member.id}
              </Link>
            ) : (
              '-'
            ),
          },
        ];

  return (
    <div className="space-y-3">
      {/* パンくず(戻るリンク) */}
      <Link href="/applications" className="sf-back-link text-xs">
        ← 申込一覧へ
      </Link>

      {/* Highlight Panel: 会員/問合せ詳細と同じ Salesforce 風カードヘッダー */}
      <HighlightPanel
        iconLabel="APP"
        iconColor="#04844b"
        objectLabel="申込"
        recordName={app.project?.name ?? '(案件未設定)'}
        recordSubName={app.id}
        facts={highlightFacts}
        actions={<ShareLinkButton />}
      />

      {/*
        申込詳細は1カード4カラムでフラットに並べる。
        ステータス更新と案件固有項目カードは表示しない(申込はCSV取込で更新される運用のため)。
      */}
      <Card>
        <CardHeader className="border-b py-3">
          <CardTitle className="text-sm">基本情報</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <DynamicDetailFields
            record={app as unknown as Record<string, unknown>}
            fields={detailFields}
            columns={4}
            // ID カラムは「氏名/案件名/ユーザー名」で見せたいので上書き表示する。
            // 表示/非表示・並び順・セクション・ラベルはすべてオブジェクトマネージャー
            // (/settings/objects/applications) のレイアウトエディタで制御する。
            fieldOverrides={{
              member_id: app.member ? (
                <Link href={`/members/${app.member.id}`} className="text-primary hover:underline">
                  {app.member.name ?? app.member.id}
                </Link>
              ) : (
                '-'
              ),
              project_id: app.project?.name ?? '-',
              acquirer_id: app.acquirer?.full_name ?? app.acquirer_name_raw ?? '-',
              owner_id: app.owner?.full_name ?? app.owner_name_raw ?? '-',
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
