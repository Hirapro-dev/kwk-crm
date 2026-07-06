/**
 * 対応歴一覧画面(仕様書 §8.1, §8.2)
 *
 * 一覧をタイムライン形式で表示する(入力は会員詳細から行う)。
 */

import { PanelFilterBar, PanelHeader } from '@/components/layout/PanelHeader';
import { Card } from '@/components/ui/card';
import { getDBunruiList, listActivities } from '@/lib/domain/activities';
import { getCurrentUser } from '@/lib/domain/auth';
import { LIST_PAGE_SIZE } from '@/lib/domain/list_constants';
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

  const [result, bunruiList] = await Promise.all([
    listActivities({ ...activityParams, page: 1, pageSize: LIST_PAGE_SIZE }),
    getDBunruiList(),
  ]);

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel="ACT"
          iconColor="#00C896"
          viewName="対応歴"
          totalCount={result.total}
        />

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
          />
        </PanelFilterBar>

        <ActivitiesInfinite
          key={`${sp.member ?? ''}|${sp.d ?? ''}|${sp.m ?? ''}|${sp.s ?? ''}|${sp.owner ?? ''}|${sp.from ?? ''}|${sp.to ?? ''}`}
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
