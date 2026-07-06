/**
 * ダッシュボード(仕様書 §8.1, §9.15)
 *
 * Phase 7 完成版:
 *   - 今日/今月の対応件数、プロテクト数
 *   - お気に入りレポート一覧(最大20件)
 *   - プロテクト会員(3日以内解除予定 or 全件最大20件)
 *   - 直近対応歴(過去24時間・全員)
 */

import { ActivityTimeline } from '@/components/activities/ActivityTimeline';
import { PanelHeader } from '@/components/layout/PanelHeader';
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
import { getCurrentUser } from '@/lib/domain/auth';
import {
  getMyDashboardStats,
  getMyLatestActivities,
  getProtectExpiringSoon,
} from '@/lib/domain/dashboard';
import { getFavoriteReportList } from '@/lib/domain/dashboard_widgets';
import { formatDateTime } from '@/lib/utils/date';
import Link from 'next/link';

export default async function DashboardPage() {
  const me = await getCurrentUser();
  const [stats, protectExpiring, recent, favorites] = await Promise.all([
    getMyDashboardStats(me.id),
    getProtectExpiringSoon(me.id),
    getMyLatestActivities(me.id, 20),
    getFavoriteReportList(me.id),
  ]);

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel="HOM"
          iconColor="#00C896"
          viewName="ダッシュボード"
          actions={
            <span className="text-xs text-muted-foreground">
              {me.full_name ?? me.email} · <Badge variant="outline">{me.role}</Badge>
            </span>
          }
        />

        {/* サマリ — ダッシュボードカード内に格納 */}
        <div className="space-y-4 p-4">
          {/* 1行目 — 対応歴 */}
          <section className="grid gap-4 sm:grid-cols-3">
            <StatCard label="今日の対応件数" value={stats.todayActivities.toLocaleString()} />
            <StatCard label="今月の対応件数" value={stats.monthActivities.toLocaleString()} />
            <StatCard
              label="プロテクト数"
              value={stats.protectCount.toLocaleString()}
              note={stats.protectCompanyWide ? '全社の有効プロテクト' : '自分の保持分'}
            />
          </section>

          {/* 2行目 — 申込(acquirer_id ベース) */}
          <section className="grid gap-4 sm:grid-cols-2">
            <StatCard
              label="今月の入金件数"
              value={stats.monthPaymentCount.toLocaleString()}
              note="申込獲得者ベース"
            />
            <StatCard
              label="今月の入金額"
              value={`¥${stats.monthPaymentAmount.toLocaleString('ja-JP')}`}
              note="申込獲得者ベース"
            />
          </section>
        </div>
      </Card>

      {/* お気に入りレポート一覧 */}
      <Card>
        <CardHeader className="border-b py-3">
          <CardTitle className="flex items-center justify-between text-sm">
            <span>お気に入りレポート</span>
            <Link
              href="/reports?favorites=1"
              className="text-xs font-normal text-primary hover:underline"
            >
              全て表示 →
            </Link>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {favorites.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              お気に入りレポートがありません。
              <Link href="/reports" className="ml-1 text-primary hover:underline">
                レポート画面
              </Link>
              でレポート名横の★をタップして追加できます。
            </p>
          ) : (
            <ul className="divide-y">
              {favorites.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/reports/${r.id}`}
                    className="flex items-center justify-between px-4 py-2.5 hover:bg-accent/50 transition-colors"
                  >
                    <span className="text-sm font-medium">★ {r.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {r.report_type}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* プロテクト会員 */}
      <Card>
        <CardHeader className="border-b py-3">
          <CardTitle className="flex items-center justify-between text-sm">
            <span>プロテクト会員</span>
            <div className="flex items-center gap-3">
              <span className="text-xs font-normal text-muted-foreground">
                {protectExpiring.expiringSoonCount > 0
                  ? `3日以内に解除予定 · ${protectExpiring.expiringSoonCount}件`
                  : `全プロテクト · ${protectExpiring.totalCount}件${protectExpiring.totalCount > 20 ? '（上位20件）' : ''}`}
              </span>
              <Link
                href="/members/protects?all=1"
                className="text-xs font-normal text-primary hover:underline"
              >
                全て表示 →
              </Link>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {protectExpiring.rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">現在プロテクト中の会員はいません</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50 hover:bg-gray-50">
                    <TableHead className="h-9 whitespace-nowrap">解除日時</TableHead>
                    <TableHead className="h-9 whitespace-nowrap">残り日数</TableHead>
                    <TableHead className="h-9 whitespace-nowrap">会員ID</TableHead>
                    <TableHead className="h-9 whitespace-nowrap">会員名</TableHead>
                    <TableHead className="h-9 whitespace-nowrap">住所</TableHead>
                    <TableHead className="h-9 whitespace-nowrap">担当者</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {protectExpiring.rows.map((m) => {
                    const isSoon = protectExpiring.expiringSoonCount > 0;
                    const diffMs = new Date(m.protect_expires_at).getTime() - Date.now();
                    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                    const remainLabel =
                      diffDays <= 0 ? '期限切れ' : diffDays === 1 ? '残り1日' : `残り${diffDays}日`;
                    const remainColor =
                      diffDays <= 1
                        ? 'text-destructive font-semibold'
                        : diffDays <= 3
                          ? 'text-orange-500 font-medium'
                          : 'text-muted-foreground';
                    return (
                      <TableRow key={m.id} className="sf-row-hover">
                        <TableCell
                          className={`whitespace-nowrap py-2 text-xs font-medium ${isSoon ? 'text-destructive' : ''}`}
                        >
                          {formatDateTime(m.protect_expires_at)}
                        </TableCell>
                        <TableCell className={`whitespace-nowrap py-2 text-xs ${remainColor}`}>
                          {remainLabel}
                        </TableCell>
                        <TableCell className="whitespace-nowrap py-2 font-mono text-xs">
                          <Link href={`/members/${m.id}`} className="text-primary hover:underline">
                            {m.id}
                          </Link>
                        </TableCell>
                        <TableCell className="whitespace-nowrap py-2 text-sm">
                          {m.name ?? '-'}
                        </TableCell>
                        <TableCell className="whitespace-nowrap py-2 text-sm">
                          {m.address ?? '-'}
                        </TableCell>
                        <TableCell className="whitespace-nowrap py-2 text-sm">
                          {m.protect_by_user?.full_name ?? '-'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 直近対応歴(過去24時間) */}
      <Card>
        <CardHeader className="border-b py-3">
          <CardTitle className="flex items-center justify-between text-sm">
            <span>直近の対応歴</span>
            <div className="flex items-center gap-3">
              <span className="text-xs font-normal text-muted-foreground">
                自分 · 直近{recent.length}件
              </span>
              <Link
                href="/activities/recent"
                className="text-xs font-normal text-primary hover:underline"
              >
                一覧を表示 →
              </Link>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ActivityTimeline
            activities={recent}
            currentUserId={me.id}
            currentUserRole={me.role}
            showMember
          />
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, note }: { label: string; value: string; note?: string }) {
  // ダッシュボードカード内に格納するため、枠線セル(border)で表現してカード入れ子の重複感を避ける
  return (
    <div className="rounded-md border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">{label}</div>
        {note && <div className="text-[10px] text-muted-foreground/60">{note}</div>}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
