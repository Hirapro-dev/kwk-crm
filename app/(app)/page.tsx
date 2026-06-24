/**
 * ダッシュボード(仕様書 §8.1, §9.15)
 *
 * Phase 7 完成版:
 *   - 今日: 自分の対応件数
 *   - 今月: 自分の対応件数、担当会員数
 *   - 最新対応歴 10件
 *   - お気に入りレポート最大3個(Phase 6 連携)
 */

import Link from 'next/link';
import { ActivityTimeline } from '@/components/activities/ActivityTimeline';
import { ReportWidget } from '@/components/dashboard/ReportWidget';
import { PanelHeader } from '@/components/layout/PanelHeader';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/domain/auth';
import { getMyDashboardStats, getMyRecentActivities } from '@/lib/domain/dashboard';
import { getFavoriteReportWidgets } from '@/lib/domain/dashboard_widgets';

export default async function DashboardPage() {
  const me = await getCurrentUser();
  const [stats, recent, widgets] = await Promise.all([
    getMyDashboardStats(me.id),
    getMyRecentActivities(me.id, 10),
    getFavoriteReportWidgets(me.id),
  ]);

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel="HOM"
          iconColor="#00C896"
          viewName="ダッシュボード"
          actions={
            <>
              <span className="text-xs text-muted-foreground">
                {me.full_name ?? me.email} ·{' '}
                <Badge variant="outline">{me.role}</Badge>
              </span>
              <Link
                href="/activities"
                className="inline-flex h-8 items-center rounded bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                + 対応歴を記録
              </Link>
            </>
          }
        />
      </Card>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="今日の対応件数" value={stats.todayActivities.toLocaleString()} />
        <StatCard label="今月の対応件数" value={stats.monthActivities.toLocaleString()} />
        <StatCard label="担当会員数" value={stats.monthMembers.toLocaleString()} />
      </section>

      {widgets.length > 0 && (
        <section>
          <h2 className="mb-2 text-base font-semibold">お気に入りレポート</h2>
          <div className="grid gap-4 lg:grid-cols-3">
            {widgets.map((w) => (
              <ReportWidget key={w.reportId} widget={w} />
            ))}
          </div>
        </section>
      )}

      <Card>
        <CardHeader>
          <CardTitle>最新対応歴 10件(自分担当)</CardTitle>
        </CardHeader>
        <CardContent>
          <ActivityTimeline activities={recent} />
        </CardContent>
      </Card>

      {widgets.length === 0 && (
        <p className="text-xs text-muted-foreground">
          ヒント: <Link href="/reports" className="text-primary hover:underline">レポート画面</Link>
          {' '}でレポート名横の★をタップすると、このダッシュボードにウィジェットが表示されます(最大3個)。
        </p>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}
