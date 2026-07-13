/**
 * 会員詳細の本体(再利用可能なサーバーコンポーネント)。
 *
 * - フルページ詳細 (/members/[id]) と、会員一覧の分割ビュー右ペインで共用する。
 * - `backTo` を渡すとパンくず(戻るリンク)を表示する。分割ビューでは省略する。
 * - `embedded` のときは詳細/対応歴を縦積みにして、狭い右ペインに収める。
 *
 * データ取得・RLS は従来の詳細ページと同じドメイン関数をそのまま使う。
 */

import { ActivityFormCard } from '@/components/activities/ActivityFormCard';
import { ActivityTimeline } from '@/components/activities/ActivityTimeline';
import { NewActivityTrigger } from '@/components/activities/NewActivityTrigger';
import { CollapsibleSection } from '@/components/layout/CollapsibleSection';
import { HighlightPanel } from '@/components/layout/HighlightPanel';
import { ShareLinkButton } from '@/components/layout/ShareLinkButton';
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
import { MemberTabs } from './[id]/MemberTabs';

interface Props {
  memberId: string;
  /** 指定するとパンくず(戻るリンク)を表示する。分割ビューでは省略。 */
  backTo?: string;
  backLabel?: string;
  /** 狭い右ペイン用: 詳細と対応歴を縦積みにする */
  embedded?: boolean;
}

export async function MemberDetailPanel({ memberId, backTo, backLabel, embedded }: Props) {
  const member = await getMember(memberId);
  if (!member) {
    // 埋め込み(分割ビュー)ではページ全体を404にせず、ペイン内にメッセージを出す。
    if (embedded) {
      return (
        <div className="p-6 text-center text-sm text-muted-foreground">
          会員が見つかりませんでした。
        </div>
      );
    }
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
    listActivities({ memberId, pageSize: 50, page: 1 }),
    getDBunruiList(),
    getRecentBunruiPairs(200),
    getVisibleFields('members', 'detail'),
    getVisibleFields('members', 'highlight'),
    listApplications({ memberId, pageSize: 100, page: 1 }),
    listInquiries({ memberId, pageSize: 100, page: 1 }),
    getReactionsByMember(memberId, 100),
  ]);

  const canAssignRegularContact = ['admin', 'manager', 'sales', 'support'].includes(me.role);

  const protectUsers =
    me.role === 'admin'
      ? (await listAllUsers({ activeOnly: true })).map((u) => ({
          id: u.id,
          full_name: u.full_name,
        }))
      : [];

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

  const gridClass = embedded ? 'grid min-w-0 gap-3' : 'grid min-w-0 gap-3 lg:grid-cols-2';

  return (
    <div className="space-y-3">
      {/* パンくず(フルページのみ) */}
      {backTo && (
        <Link href={backTo} className="sf-back-link text-xs">
          ← {backLabel ?? '戻る'}
        </Link>
      )}

      {/* Highlight Panel */}
      <HighlightPanel
        iconLabel="MEM"
        iconColor="#00C896"
        objectLabel="会員"
        recordName={member.name ?? '(名称未設定)'}
        recordSubName={`${member.id}${member.name_kana ? ` ・ ${member.name_kana}` : ''}`}
        facts={highlightFacts}
        actions={
          <>
            {/* 共有ボタンは全ロール表示。編集/削除の左隣に配置する */}
            <ShareLinkButton />
            {me.role === 'admin' && (
              <>
                <MemberEditDialog
                  member={member}
                  currentUserRole={me.role}
                  protectUsers={protectUsers}
                  detailFields={detailFields}
                />
                <MemberDeleteButton memberId={member.id} memberName={member.name ?? member.id} />
              </>
            )}
          </>
        }
      />

      {/* ハイライトとタブの間: 対応歴作成ショートカット */}
      <NewActivityTrigger />

      {/* 左: 詳細/関連タブ, 右: 対応歴カード。embedded 時は縦積み。 */}
      <div className={gridClass}>
        <MemberTabs
          detailsContent={
            // 分割ビュー(embedded)では基本情報を既定で折りたたみ、対応歴をすぐ見えるようにする
            <CollapsibleSection title="基本情報" defaultOpen={!embedded}>
              <DynamicDetailFields
                record={member as unknown as Record<string, unknown>}
                fields={detailFields}
                fieldOverrides={{
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
              {/* 申込履歴 */}
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

              {/* 問合せ履歴 */}
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

              {/* 記事反応履歴 */}
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

        {/* 右カラム: 対応歴カード */}
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
