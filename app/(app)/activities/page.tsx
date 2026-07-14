/**
 * 対応歴一覧画面(仕様書 §8.1, §8.2)
 *
 * 一覧をタイムライン形式で表示する(入力は会員詳細から行う)。
 */

import { PanelFilterBar, PanelHeader } from '@/components/layout/PanelHeader';
import { ResizableSplit } from '@/components/layout/ResizableSplit';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { getDBunruiList, listActivities } from '@/lib/domain/activities';
import { getCurrentUser } from '@/lib/domain/auth';
import { LIST_PAGE_SIZE } from '@/lib/domain/list_constants';
import { listAllUsers } from '@/lib/domain/users_admin';
import Link from 'next/link';
import { MemberDetailPanel } from '../members/MemberDetailPanel';
import { ActivitiesFilterBar } from './ActivitiesFilterBar';
import { ActivitiesInfinite } from './ActivitiesInfinite';

interface PageProps {
  searchParams: Promise<{
    member?: string;
    d?: string;
    m?: string;
    s?: string;
    from?: string;
    to?: string;
    owner?: string;
    page?: string;
    /** 'split' で分割ビュー */
    view?: string;
    /** 分割ビューで右ペインに表示する会員ID */
    selected?: string;
  }>;
}

export default async function ActivitiesPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const me = await getCurrentUser();

  // 無限スクロール: 初期は1ページ目のみ取得
  const activityParams = {
    memberId: sp.member || undefined,
    dBunrui: sp.d || undefined,
    mBunrui: sp.m || undefined,
    sBunrui: sp.s || undefined,
    ownerId: sp.owner || undefined,
    from: sp.from ? `${sp.from}T00:00:00+09:00` : undefined,
    to: sp.to ? `${sp.to}T23:59:59+09:00` : undefined,
  } as const;

  const [result, bunruiList, users] = await Promise.all([
    listActivities({ ...activityParams, page: 1, pageSize: LIST_PAGE_SIZE }),
    getDBunruiList(),
    // 担当者フィルタ用の対応者候補(有効ユーザー全ロール)。結果は実行ユーザーの RLS で自然に絞られる。
    listAllUsers({ activeOnly: true }),
  ]);

  const ownerOptions = users.map((u) => ({ id: u.id, name: u.full_name ?? u.email }));

  const isSplit = sp.view === 'split';
  const selected = sp.selected;
  const listKey = `${sp.member ?? ''}|${sp.d ?? ''}|${sp.m ?? ''}|${sp.s ?? ''}|${sp.owner ?? ''}|${sp.from ?? ''}|${sp.to ?? ''}`;

  // 表示条件を維持したままモードだけ切り替えるリンクを作る
  const baseParams = () => {
    const p = new URLSearchParams();
    if (sp.member) p.set('member', sp.member);
    if (sp.d) p.set('d', sp.d);
    if (sp.m) p.set('m', sp.m);
    if (sp.s) p.set('s', sp.s);
    if (sp.owner) p.set('owner', sp.owner);
    if (sp.from) p.set('from', sp.from);
    if (sp.to) p.set('to', sp.to);
    return p;
  };
  const toSplitHref = (() => {
    const p = baseParams();
    p.set('view', 'split');
    return `/activities?${p.toString()}`;
  })();
  const toListHref = (() => {
    const qs = baseParams().toString();
    return qs ? `/activities?${qs}` : '/activities';
  })();

  const filterBar = (
    <PanelFilterBar>
      <ActivitiesFilterBar
        initialMemberId={sp.member ?? ''}
        initialDBunrui={sp.d ?? ''}
        initialMBunrui={sp.m ?? ''}
        initialSBunrui={sp.s ?? ''}
        initialFrom={sp.from ?? ''}
        initialTo={sp.to ?? ''}
        initialOwner={sp.owner ?? 'all'}
        bunruiList={bunruiList}
        currentUserId={me.id}
        ownerOptions={ownerOptions}
      />
    </PanelFilterBar>
  );

  // ---------- 分割ビュー ----------
  if (isSplit) {
    return (
      <ResizableSplit
        className="h-[calc(100dvh-8.5rem)] min-h-[420px]"
        storageKey="activities-split-left-pct"
        left={
          <Card className="flex h-full flex-col overflow-hidden p-0 shadow-sm">
            <PanelHeader
              iconLabel="ACT"
              iconColor="#00C896"
              viewName="対応歴"
              totalCount={result.total}
              actions={
                <Link href={toListHref}>
                  <Button variant="outline" size="sm">
                    一覧表示
                  </Button>
                </Link>
              }
            />
            {filterBar}
            <div className="flex min-h-0 flex-1 flex-col">
              <ActivitiesInfinite
                key={listKey}
                initialRows={result.rows}
                total={result.total}
                currentUserId={me.id}
                currentUserRole={me.role}
                params={activityParams}
                splitMode
                selectedMemberId={selected}
              />
            </div>
          </Card>
        }
        right={
          <div className="h-full overflow-y-auto rounded border bg-background p-3 shadow-sm">
            {selected ? (
              <MemberDetailPanel memberId={selected} embedded />
            ) : (
              <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
                左の一覧で会員名を選ぶと、ここにその会員の詳細が表示されます。
              </div>
            )}
          </div>
        }
      />
    );
  }

  // ---------- 通常(一覧のみ) ----------
  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel="ACT"
          iconColor="#00C896"
          viewName="対応歴"
          totalCount={result.total}
          actions={
            <Link href={toSplitHref}>
              <Button variant="outline" size="sm">
                分割ビュー
              </Button>
            </Link>
          }
        />

        {filterBar}

        <ActivitiesInfinite
          key={listKey}
          initialRows={result.rows}
          total={result.total}
          currentUserId={me.id}
          currentUserRole={me.role}
          params={activityParams}
        />
      </Card>
    </div>
  );
}
