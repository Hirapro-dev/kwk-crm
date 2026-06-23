/**
 * 会員詳細画面(仕様書 §8.1)
 * Salesforce Lightning Record Page 風レイアウト:
 *  - Highlight Panel (上部サマリ)
 *  - 上部タブ (詳細/関連)
 *  - 詳細タブ: 2カラム(左=基本情報、右=活動カード)
 *
 * 2026-05 更新:
 *  - 「活動」タブを削除し、活動操作は詳細タブ右カラムに集約
 *  - 右カラムは「+ 活動を追加」ボタン + 表形式の活動履歴
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ActivityFormCard } from '@/components/activities/ActivityFormCard';
import { ActivityTimeline } from '@/components/activities/ActivityTimeline';
import { CollapsibleSection } from '@/components/layout/CollapsibleSection';
import { HighlightPanel } from '@/components/layout/HighlightPanel';
import { PhoneLink } from '@/components/layout/PhoneLink';
import { DynamicDetailFields } from '@/components/objects/DynamicDetailFields';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getDBunruiList, getRecentBunruiPairs, listActivities } from '@/lib/domain/activities';
import { listApplications } from '@/lib/domain/applications';
import { listInquiries } from '@/lib/domain/inquiries';
import { getMember } from '@/lib/domain/members';
import { getVisibleFields } from '@/lib/domain/object_metadata';
import { formatDate, formatDateTime } from '@/lib/utils/date';
import { MemberTabs } from './MemberTabs';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MemberDetailPage({ params }: PageProps) {
  const { id } = await params;
  const member = await getMember(id);
  if (!member) {
    notFound();
  }

  const [activities, bunruiList, recentPairs, detailFields, relApps, relInqs] =
    await Promise.all([
      listActivities({ memberId: id, pageSize: 50, page: 1 }),
      getDBunruiList(),
      getRecentBunruiPairs(200),
      // Phase 2: オブジェクト管理機能の field_definitions に基づき表示するフィールドを取得
      getVisibleFields('members', 'detail'),
      // 関連タブで表示する申込・問合せ (member_id で紐付け、最大100件)
      listApplications({ memberId: id, pageSize: 100, page: 1 }),
      listInquiries({ memberId: id, pageSize: 100, page: 1 }),
    ]);

  // プロテクト(担当)。将来は専用システムのユーザー名が入る想定。現状は担当者を表示。
  const protectLabel = member.owner
    ? (member.owner.full_name ?? member.owner.email)
    : (member.owner_name_raw ?? 'Free');

  // 弁護士対応 / 番号違い・別人 等のフラグは extra(JSONB) から判定(なければ「なし」)
  const isExtraOn = (key: string): boolean => {
    const v = member.extra?.[key];
    if (v === true) return true;
    if (typeof v === 'string') {
      const s = v.trim();
      return s !== '' && !/^(false|0|なし|no|×|off)$/i.test(s);
    }
    return false;
  };
  const flagValue = (on: boolean) =>
    on ? (
      <Badge variant="destructive">あり</Badge>
    ) : (
      <span className="text-muted-foreground">なし</span>
    );

  return (
    <div className="space-y-3">
      {/* パンくず */}
      <Link href="/members" className="sf-back-link text-xs">
        ← 会員一覧へ
      </Link>

      {/* Highlight Panel */}
      <HighlightPanel
        iconLabel="MEM"
        iconColor="#1589ee"
        objectLabel="会員"
        recordName={member.name ?? '(名称未設定)'}
        recordSubName={`${member.id}${member.name_kana ? ` ・ ${member.name_kana}` : ''}`}
        facts={[
          { label: 'プロテクト', value: protectLabel },
          { label: '電話番号', value: <PhoneLink value={member.phone1} /> },
          { label: '架電NG', value: flagValue(member.do_not_call) },
          { label: '弁護士対応', value: flagValue(isExtraOn('弁護士対応')) },
          { label: '番号違い・別人', value: flagValue(isExtraOn('番号違い・別人')) },
        ]}
        actions={
          <>
            <Button variant="outline" size="sm">
              フォロー
            </Button>
            <Button variant="outline" size="sm">
              編集
            </Button>
            <Button variant="outline" size="sm">
              削除
            </Button>
          </>
        }
      />

      {/*
        左: 詳細/関連タブカード, 右: 活動カード (独立) を横並び 1:1。
        lg 未満は縦並び。
      */}
      <div className="grid gap-3 lg:grid-cols-2">
        {/* 左カラム: 詳細/関連 タブ */}
        <MemberTabs
          detailsContent={
            <CollapsibleSection title="基本情報">
              {/*
                Phase 2: オブジェクト管理機能 (/settings/objects/members) で
                「詳細」表示ONになっているフィールドのみ動的にレンダリングする。
              */}
              <DynamicDetailFields
                record={member as unknown as Record<string, unknown>}
                fields={detailFields}
              />
            </CollapsibleSection>
          }
          relatedContent={
            <div className="space-y-3">
              {/* 申込履歴 (member_id で紐付け) */}
              <CollapsibleSection title="申込履歴" count={relApps.total} bodyClassName="p-0">
                  {relApps.rows.length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground">
                      申込はありません
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-secondary/50 hover:bg-secondary/50">
                            <TableHead className="h-9 whitespace-nowrap">申込ID</TableHead>
                            <TableHead className="h-9 whitespace-nowrap">案件</TableHead>
                            <TableHead className="h-9 whitespace-nowrap">申込日</TableHead>
                            <TableHead className="h-9 whitespace-nowrap">ステータス</TableHead>
                            <TableHead className="h-9 whitespace-nowrap text-right">
                              入金額
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {relApps.rows.map((a) => (
                            <TableRow key={a.id} className="sf-row-hover">
                              <TableCell className="whitespace-nowrap py-2">
                                <Link
                                  href={`/applications/${a.id}`}
                                  className="text-primary hover:underline"
                                >
                                  {a.id}
                                </Link>
                              </TableCell>
                              <TableCell className="whitespace-nowrap py-2">
                                {a.project?.name ?? '-'}
                              </TableCell>
                              <TableCell className="whitespace-nowrap py-2">
                                {formatDate(a.application_date) || '-'}
                              </TableCell>
                              <TableCell className="whitespace-nowrap py-2">
                                {a.status ? <Badge>{a.status}</Badge> : '-'}
                              </TableCell>
                              <TableCell className="whitespace-nowrap py-2 text-right tabular-nums">
                                {a.payment_amount !== null
                                  ? `¥${Number(a.payment_amount).toLocaleString()}`
                                  : '-'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
              </CollapsibleSection>

              {/* 問合せ履歴 (member_id で紐付け) */}
              <CollapsibleSection title="問合せ履歴" count={relInqs.total} bodyClassName="p-0">
                  {relInqs.rows.length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground">
                      問合せはありません
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-secondary/50 hover:bg-secondary/50">
                            <TableHead className="h-9 whitespace-nowrap">問合せID</TableHead>
                            <TableHead className="h-9 whitespace-nowrap">フォーム</TableHead>
                            <TableHead className="h-9 whitespace-nowrap">登録日時</TableHead>
                            <TableHead className="h-9 whitespace-nowrap">氏名</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {relInqs.rows.map((q) => (
                            <TableRow key={q.id} className="sf-row-hover">
                              <TableCell className="whitespace-nowrap py-2">
                                <Link
                                  href={`/inquiries/${q.id}`}
                                  className="text-primary hover:underline"
                                >
                                  {q.id}
                                </Link>
                              </TableCell>
                              <TableCell className="whitespace-nowrap py-2">
                                {q.form?.name ?? '-'}
                              </TableCell>
                              <TableCell className="whitespace-nowrap py-2">
                                {formatDateTime(q.registered_at) || '-'}
                              </TableCell>
                              <TableCell className="whitespace-nowrap py-2">
                                {q.name ?? '-'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
              </CollapsibleSection>
            </div>
          }
        />

        {/* 右カラム: 活動カード (タブの外、独立) */}
        <Card>
          <CardHeader className="border-b py-3">
            <CardTitle className="flex items-center justify-between text-sm">
              <span>活動</span>
              <span className="text-xs font-normal text-muted-foreground">
                {activities.total.toLocaleString()}件
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            <ActivityFormCard
              memberId={member.id}
              bunruiList={bunruiList}
              recentPairs={recentPairs}
            />
            <ActivityTimeline activities={activities.rows} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// InfoRow ヘルパーは DynamicDetailFields に置換されたため削除
// (Phase 2 で field_definitions ベースの動的レンダリングに移行)
