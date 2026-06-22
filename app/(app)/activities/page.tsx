/**
 * 活動一覧画面(仕様書 §8.1, §8.2)
 *
 * 本システムの中核画面。新規入力フォームを上部に常設し、
 * その下に一覧をタイムライン形式で表示する。
 */

import { ActivityForm } from '@/components/activities/ActivityForm';
import { ActivityTimeline } from '@/components/activities/ActivityTimeline';
import { PanelFilterBar, PanelHeader } from '@/components/layout/PanelHeader';
import { Card } from '@/components/ui/card';
import { PaginationBar } from '@/components/ui/pagination-link';
import { getCurrentUser } from '@/lib/domain/auth';
import {
  getDBunruiList,
  getRecentBunruiPairs,
  listActivities,
} from '@/lib/domain/activities';
import { ActivitiesFilterBar } from './ActivitiesFilterBar';

interface PageProps {
  searchParams: Promise<{
    member?: string;
    d?: string;
    from?: string;
    to?: string;
    owner?: string;
    page?: string;
  }>;
}

export default async function ActivitiesPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const me = await getCurrentUser();
  const page = Number.parseInt(sp.page ?? '1', 10) || 1;

  const [result, bunruiList, recentPairs] = await Promise.all([
    listActivities({
      memberId: sp.member || undefined,
      dBunrui: sp.d || undefined,
      ownerId: sp.owner || undefined,
      from: sp.from ? `${sp.from}T00:00:00+09:00` : undefined,
      to: sp.to ? `${sp.to}T23:59:59+09:00` : undefined,
      page,
      pageSize: 50,
    }),
    getDBunruiList(),
    getRecentBunruiPairs(200),
  ]);

  return (
    <div className="space-y-3">
      {/* 主役: 入力フォーム(上部固定、カードはフォーム側で持つ) */}
      <ActivityForm bunruiList={bunruiList} recentPairs={recentPairs} initiallyOpen />

      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel="ACT"
          iconColor="#1589ee"
          viewName="活動履歴"
          totalCount={result.total}
        />

        <PanelFilterBar>
          <ActivitiesFilterBar
            initialMemberId={sp.member ?? ''}
            initialDBunrui={sp.d ?? ''}
            initialFrom={sp.from ?? ''}
            initialTo={sp.to ?? ''}
            initialOwner={sp.owner ?? 'all'}
            bunruiList={bunruiList}
            currentUserId={me.id}
          />
        </PanelFilterBar>

        <div className="p-2">
          <ActivityTimeline activities={result.rows} />
        </div>
      </Card>

      <PaginationBar
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        basePath="/activities"
        searchParams={sp}
      />
    </div>
  );
}
