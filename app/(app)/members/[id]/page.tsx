/**
 * 会員詳細画面(仕様書 §8.1)
 * Salesforce Lightning Record Page 風レイアウト:
 *  - Highlight Panel (上部サマリ)
 *  - 上部タブ (詳細/関連)
 *  - 詳細タブ: 2カラム(左=基本情報、右=対応歴カード)
 *
 * 2026-05 更新:
 *  - 「対応歴」タブを削除し、対応歴操作は詳細タブ右カラムに集約
 *  - 右カラムは「+ 対応歴を追加」ボタン + 表形式の対応歴
 */

import { ActivityFormCard } from '@/components/activities/ActivityFormCard';
import { ActivityTimeline } from '@/components/activities/ActivityTimeline';
import { NewActivityTrigger } from '@/components/activities/NewActivityTrigger';
import { CollapsibleSection } from '@/components/layout/CollapsibleSection';
import { HighlightPanel } from '@/components/layout/HighlightPanel';
import { renderHighlightFieldValue } from '@/components/members/HighlightFieldValue';
import { MemberDeleteButton } from '@/components/members/MemberDeleteButton';
import { MemberEditDialog } from '@/components/members/MemberEditDialog';
import { RegularContactButton } from '@/components/members/RegularContactButton';
import { DynamicDetailFields } from '@/components/objects/DynamicDetailFields';
import { Badge } from '@/components/ui/badge';
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
import { getReactionsByMember } from '@/lib/domain/article_reactions';
import { getCurrentUser } from '@/lib/domain/auth';
import { listInquiries } from '@/lib/domain/inquiries';
import { getMember } from '@/lib/domain/members';
import { getVisibleFields } from '@/lib/domain/object_metadata';
import { listAllUsers } from '@/lib/domain/users_admin';
import { formatDate, formatDateTime } from '@/lib/utils/date';
import Link from 'next/link';
import { notFound } from 'next/navigation';
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

  const me = await getCurrentUser();

  const [
    activities,
    bunruiList,
    recentPairs,
    detailFields,
    highlightFields,
    relApps,
    relInqs,
    relReactions,
  ] = await Promise.all([
    listActivities({ memberId: id, pageSize: 50, page: 1 }),
    getDBunruiList(),
    getRecentBunruiPairs(200),
    // Phase 2: オブジェクト管理機能の field_definitions に基づき表示するフィールドを取得
    getVisibleFields('members', 'detail'),
    // Phase 2.6: ハイライトパネルのフィールド設定
    getVisibleFields('members', 'highlight'),
    // 関連タブで表示する申込・問合せ (member_id で紐付け、最大100件)
    listApplications({ memberId: id, pageSize: 100, page: 1 }),
    listInquiries({ memberId: id, pageSize: 100, page: 1 }),
    // 記事反応履歴 (member_id で紐付け、最大100件)
    getReactionsByMember(id, 100),
  ]);

  // 定期連絡者を自分に割り当て可能なロール (viewer 以外)
  const canAssignRegularContact = ['admin', 'manager', 'sales', 'support'].includes(me.role);

  // プロテクト者の選択肢 (admin のみ。プロテクト編集UIで使用)
  const protectUsers =
    me.role === 'admin'
      ? (await listAllUsers({ activeOnly: true })).map((u) => ({
          id: u.id,
          full_name: u.full_name,
        }))
      : [];

  // ハイライトパネルの facts を動的生成
  // highlight フィールドが未設定のときは最低限の情報をフォールバック表示
  const highlightFacts =
    highlightFields.length > 0
      ? highlightFields.map((f) => ({
          label: f.label ?? f.field_name,
          value: renderHighlightFieldValue(f, member),
        }))
      : [
          {
            label: 'プロテクト',
            value: member.protect_by_user_id ? (
              <span>
                {member.protect_by_user?.full_name ?? 'free'}
                {member.protect_expires_at && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {member.protect_expires_at >= '2099-01-01'
                      ? '(固定)'
                      : `〜${formatDate(member.protect_expires_at)}`}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground">free</span>
            ),
          },
        ];

  return (
    <div className="space-y-3">
      {/* パンくず */}
      <Link href="/members" className="sf-back-link text-xs">
        ← 会員一覧へ
      </Link>

      {/* Highlight Panel */}
      <HighlightPanel
        iconLabel="MEM"
        iconColor="#00C896"
        objectLabel="会員"
        recordName={member.name ?? '(名称未設定)'}
        recordSubName={`${member.id}${member.name_kana ? ` ・ ${member.name_kana}` : ''}`}
        facts={highlightFacts}
        actions={
          // 編集・削除は管理者のみ
          me.role === 'admin' ? (
            <>
              <MemberEditDialog
                member={member}
                currentUserRole={me.role}
                protectUsers={protectUsers}
              />
              <MemberDeleteButton memberId={member.id} memberName={member.name ?? member.id} />
            </>
          ) : null
        }
      />

      {/* ハイライトとタブの間: 対応歴作成ショートカット */}
      <NewActivityTrigger />

      {/*
        左: 詳細/関連タブカード, 右: 対応歴カード (独立) を横並び 1:1。
        lg 未満は縦並び。
      */}
      <div className="grid min-w-0 gap-3 lg:grid-cols-2">
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
                fieldOverrides={{
                  // プロテクト解除後経過日数(現在プロテクト中は「—」)
                  protect_released_at: (() => {
                    const exp = member.protect_expires_at;
                    const isProtected = !!exp && new Date(exp).getTime() > Date.now();
                    if (isProtected) {
                      return <span className="text-muted-foreground">プロテクト中</span>;
                    }
                    if (!member.protect_released_at) {
                      return <span className="text-muted-foreground">—</span>;
                    }
                    const days = Math.floor(
                      (Date.now() - new Date(member.protect_released_at).getTime()) /
                        (1000 * 60 * 60 * 24),
                    );
                    return (
                      <span>
                        解除後 {days}日
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          ({formatDate(member.protect_released_at)} 解除)
                        </span>
                      </span>
                    );
                  })(),
                  regular_contact_id: canAssignRegularContact ? (
                    <RegularContactButton
                      memberId={member.id}
                      currentName={member.regular_contact?.full_name ?? null}
                      isSelf={member.regular_contact_id === me.id}
                    />
                  ) : (
                    <span className={member.regular_contact ? '' : 'text-muted-foreground'}>
                      {member.regular_contact?.full_name ?? '未設定'}
                    </span>
                  ),
                  protect_by_user_id: member.protect_by_user_id ? (
                    <span>
                      {member.protect_by_user?.full_name ?? 'free'}
                      {member.protect_expires_at && (
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          {member.protect_expires_at >= '2099-01-01'
                            ? '(固定)'
                            : `〜${formatDate(member.protect_expires_at)}`}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">free</span>
                  ),
                }}
              />
            </CollapsibleSection>
          }
          relatedContent={
            <div className="space-y-3">
              {/* 申込履歴 (member_id で紐付け) */}
              <CollapsibleSection title="申込履歴" count={relApps.total} bodyClassName="p-0">
                {relApps.rows.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">申込はありません</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-gray-50 hover:bg-gray-50">
                          <TableHead className="h-9 whitespace-nowrap">申込ID</TableHead>
                          <TableHead className="h-9 whitespace-nowrap">案件</TableHead>
                          <TableHead className="h-9 whitespace-nowrap">申込日</TableHead>
                          <TableHead className="h-9 whitespace-nowrap">ステータス</TableHead>
                          <TableHead className="h-9 whitespace-nowrap text-right">入金額</TableHead>
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
                  <p className="p-4 text-sm text-muted-foreground">問合せはありません</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-gray-50 hover:bg-gray-50">
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

              {/* 記事反応履歴 (member_id で紐付け) */}
              <CollapsibleSection
                title="記事反応履歴"
                count={relReactions.length}
                bodyClassName="p-0"
              >
                {relReactions.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">記事反応はありません</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-gray-50 hover:bg-gray-50">
                          <TableHead className="h-9 whitespace-nowrap">日付</TableHead>
                          <TableHead className="h-9 whitespace-nowrap">配信媒体</TableHead>
                          <TableHead className="h-9 whitespace-nowrap">配信ツール</TableHead>
                          <TableHead className="h-9 whitespace-nowrap">種類</TableHead>
                          <TableHead className="h-9 whitespace-nowrap">詳細</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {relReactions.map((r) => (
                          <TableRow key={r.id} className="sf-row-hover">
                            <TableCell className="whitespace-nowrap py-2">
                              {formatDate(r.reacted_date) || '-'}
                            </TableCell>
                            <TableCell className="whitespace-nowrap py-2">
                              {r.media ?? '-'}
                            </TableCell>
                            <TableCell className="whitespace-nowrap py-2">
                              {r.tool ?? '-'}
                            </TableCell>
                            <TableCell className="whitespace-nowrap py-2">
                              {r.reaction_type ?? '-'}
                            </TableCell>
                            <TableCell className="py-2">{r.detail ?? '-'}</TableCell>
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

        {/* 右カラム: 対応歴カード (タブの外、独立) */}
        <Card id="activity-form-section" className="min-w-0 overflow-hidden">
          <CardHeader className="border-b py-3">
            <CardTitle className="flex items-center justify-between text-sm">
              <span>対応歴</span>
              <span className="text-xs font-normal text-muted-foreground">
                {activities.total.toLocaleString()}件
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="min-w-0 space-y-3 overflow-hidden p-4">
            <ActivityFormCard
              memberId={member.id}
              bunruiList={bunruiList}
              recentPairs={recentPairs}
            />
            <ActivityTimeline
              activities={activities.rows}
              currentUserId={me.id}
              currentUserRole={me.role}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// InfoRow ヘルパーは DynamicDetailFields に置換されたため削除
// (Phase 2 で field_definitions ベースの動的レンダリングに移行)
