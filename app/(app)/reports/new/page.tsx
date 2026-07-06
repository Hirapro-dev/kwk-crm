/**
 * レポート新規作成: ステップ1(レポートタイプ選択) → ステップ2(ビルダー)
 * 仕様書 §9.9 / §9.10
 */

import { HighlightPanel } from '@/components/layout/HighlightPanel';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/domain/auth';
import { listAllUsers } from '@/lib/domain/users_admin';
import { loadExtraColumnsForReportType } from '@/lib/reports/extra_columns';
import { SUMMARY_TEMPLATE_TYPES } from '@/lib/reports/object_pairs';
import { REPORT_TYPES, type ReportTypeId } from '@/lib/reports/types';
import Link from 'next/link';
import { ReportBuilder } from '../builder/ReportBuilder';
import { ObjectSelector } from './ObjectSelector';

// extra 項目(field_definitions)を毎回最新で読み込むため常に動的レンダリング
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ type?: string }>;
}

export default async function NewReportPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const type = sp.type as ReportTypeId | undefined;

  if (!type || !REPORT_TYPES[type]) {
    return (
      <div className="space-y-3">
        {/* パンくず */}
        <Link href="/reports" className="sf-back-link text-xs">
          ← レポート一覧へ
        </Link>

        {/* Highlight Panel: 新規レポートタイプ選択 */}
        <HighlightPanel
          iconLabel="RPT"
          iconColor="#9333ea"
          objectLabel="レポート新規作成"
          recordName="ステップ1: オブジェクトを選択"
          recordSubName="主軸オブジェクトと、必要なら結合するオブジェクトを選びます"
        />

        {/* オブジェクト選択(主軸 + 任意の結合) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">オブジェクトを選択</CardTitle>
            <CardDescription>
              主軸オブジェクトを選び、必要に応じて結合するオブジェクトを 1 つ選びます。
              「次へ」でカラム・フィルタの設定に進みます。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ObjectSelector />
          </CardContent>
        </Card>

        {/* 集計テンプレート(オブジェクト選択フローに馴染まない集計系) */}
        <div className="space-y-2">
          <p className="px-1 text-sm font-medium">集計テンプレートから作成</p>
          <p className="px-1 text-xs text-muted-foreground">
            会員ごと・案件ごとの集計や、担当×期間のクロス集計はこちらから。
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {SUMMARY_TEMPLATE_TYPES.map((id) => {
              const t = REPORT_TYPES[id];
              return (
                <Link key={t.id} href={`/reports/new?type=${t.id}`}>
                  <Card className="h-full transition-colors hover:bg-accent/50">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Badge variant="outline">{t.id}</Badge>
                        {t.name}
                      </CardTitle>
                      <CardDescription>{t.description}</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0 text-xs text-muted-foreground">
                      単位: {t.unit}
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // 主軸オブジェクトの extra jsonb キー一覧を field_definitions から取得して
  // レポートビルダーに渡す。これによりオブジェクト管理画面で CSV から登録した
  // カラム(170+列)もレポートで利用可能になる。
  const extraColumns = await loadExtraColumnsForReportType(type);

  // 「指定ユーザーのみ」は admin のみ設定可。admin のときだけ有効ユーザー一覧を渡す。
  const me = await getCurrentUser();
  const canRestrict = me.role === 'admin';
  const assignableUsers = canRestrict
    ? (await listAllUsers({ activeOnly: true })).map((u) => ({ id: u.id, full_name: u.full_name }))
    : [];

  return (
    <div className="space-y-3">
      {/* パンくず */}
      <Link href="/reports/new" className="sf-back-link text-xs">
        ← オブジェクト選択に戻る
      </Link>

      {/* Highlight Panel: ビルダー画面 */}
      <HighlightPanel
        iconLabel="RPT"
        iconColor="#9333ea"
        objectLabel="新規レポート"
        recordName={REPORT_TYPES[type].name}
        recordSubName={REPORT_TYPES[type].description}
        facts={[
          { label: 'タイプ', value: <Badge>{type}</Badge> },
          { label: '単位', value: REPORT_TYPES[type].unit },
          { label: '拡張項目', value: `${extraColumns.length}件` },
        ]}
      />

      <ReportBuilder
        reportType={type}
        extraColumns={extraColumns}
        canRestrict={canRestrict}
        assignableUsers={assignableUsers}
      />
    </div>
  );
}
