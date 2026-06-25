/**
 * 直近の対応歴一覧 /activities/recent
 * ログインユーザー自身の過去1週間分の対応歴を、日付ごとにグルーピング表示する。
 */

import { ActivityTimeline } from '@/components/activities/ActivityTimeline';
import { PanelHeader } from '@/components/layout/PanelHeader';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/domain/auth';
import { getRecentActivitiesNDays } from '@/lib/domain/dashboard';
import type { ActivityListItem } from '@/lib/domain/types';
import { formatDate } from '@/lib/utils/date';
import Link from 'next/link';

export const metadata = { title: '直近の対応歴' };

const DAYS = 7;

export default async function RecentActivitiesPage() {
  const me = await getCurrentUser();
  const activities = await getRecentActivitiesNDays(me.id, DAYS, 500);

  // 日付(JST)でグルーピング。registered_datetime 優先、無ければ registered_date。
  const groups = new Map<string, ActivityListItem[]>();
  for (const a of activities) {
    const key = formatDate(a.registered_datetime ?? a.registered_date ?? '') || '日付不明';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(a);
  }

  // 取得時点で降順なので、キーの出現順がそのまま新しい日付順になる
  const sortedKeys = Array.from(groups.keys());

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel="ACT"
          iconColor="#00C896"
          viewName="直近の対応歴"
          actions={
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                自分 · 過去{DAYS}日間 · {activities.length}件
              </span>
              <Link href="/" className="text-xs text-muted-foreground hover:underline">
                ← ダッシュボードへ
              </Link>
            </div>
          }
        />
      </Card>

      {activities.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            過去{DAYS}日間の対応歴はありません
          </CardContent>
        </Card>
      ) : (
        sortedKeys.map((key) => {
          const rows = groups.get(key)!;
          return (
            <Card key={key} className="overflow-hidden">
              {/* 日付グループヘッダー */}
              <div className="flex items-center gap-2 border-b bg-gray-50 px-4 py-2.5">
                <Badge variant="outline" className="text-xs">
                  {key}
                </Badge>
                <span className="text-xs text-muted-foreground">{rows.length}件</span>
              </div>
              <ActivityTimeline
                activities={rows}
                currentUserId={me.id}
                currentUserRole={me.role}
                showMember
              />
            </Card>
          );
        })
      )}
    </div>
  );
}
