/**
 * レポート一覧画面(仕様書 §8.1, §9.9)
 * - 標準レポート(is_standard=true)を上部にまとめる
 * - お気に入り絞り込み・タイプ別フィルタ
 */

import Link from 'next/link';
import { PanelHeader } from '@/components/layout/PanelHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getCurrentUser } from '@/lib/domain/auth';
import { listReports } from '@/lib/domain/reports';
import { REPORT_TYPES } from '@/lib/reports/types';
import { formatDateTime } from '@/lib/utils/date';
import { FavoriteButton } from './FavoriteButton';

interface PageProps {
  searchParams: Promise<{ favorites?: string }>;
}

export default async function ReportsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const me = await getCurrentUser();
  const favoritesOnly = sp.favorites === '1';
  const reports = await listReports({
    favoritesOnly,
    userId: me.id,
  });

  const standard = reports.filter((r) => r.is_standard);
  const custom = reports.filter((r) => !r.is_standard);

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel="RPT"
          iconColor="#9333ea"
          viewName="レポート"
          totalCount={reports.length}
          actions={
            <>
              <Link href="/reports">
                <Button variant={favoritesOnly ? 'outline' : 'default'} size="sm">
                  すべて
                </Button>
              </Link>
              <Link href="/reports?favorites=1">
                <Button variant={favoritesOnly ? 'default' : 'outline'} size="sm">
                  ★ お気に入り
                </Button>
              </Link>
              <Link href="/reports/new">
                <Button size="sm">+ 新規レポート</Button>
              </Link>
            </>
          }
        />
      </Card>

      {standard.length > 0 && !favoritesOnly && (
        <ReportTable title="標準レポート" rows={standard} currentUserId={me.id} />
      )}

      <ReportTable
        title={favoritesOnly ? 'お気に入り' : 'カスタムレポート'}
        rows={favoritesOnly ? reports : custom}
        currentUserId={me.id}
      />
    </div>
  );
}

function ReportTable({
  title,
  rows,
  currentUserId,
}: {
  title: string;
  rows: Awaited<ReturnType<typeof listReports>>;
  currentUserId: string;
}) {
  return (
    <Card className="overflow-hidden p-0 shadow-sm">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-bold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground">{rows.length} 件</p>
      </div>
      <div className="overflow-x-auto">
        <Table className="min-w-[600px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead className="whitespace-nowrap">レポート名</TableHead>
              <TableHead className="whitespace-nowrap">タイプ</TableHead>
              <TableHead className="whitespace-nowrap">公開範囲</TableHead>
              <TableHead className="whitespace-nowrap">作成者</TableHead>
              <TableHead className="whitespace-nowrap">最終実行</TableHead>
              <TableHead className="whitespace-nowrap text-right">最終件数</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                  レポートがありません
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => {
                const isFav = (r.favorited_by ?? []).includes(currentUserId);
                const typeMeta = REPORT_TYPES[r.report_type as keyof typeof REPORT_TYPES];
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <FavoriteButton reportId={r.id} isFavorited={isFav} />
                    </TableCell>
                    <TableCell className="min-w-[160px]">
                      <Link
                        href={`/reports/${r.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {r.name}
                      </Link>
                      {r.description && (
                        <div className="text-xs text-muted-foreground">{r.description}</div>
                      )}
                      {r.is_standard && (
                        <Badge variant="success" className="mt-1">
                          標準
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      <Badge variant="outline">{r.report_type}</Badge>
                      {typeMeta && (
                        <span className="ml-1 text-muted-foreground">{typeMeta.name}</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{r.visibility}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{r.creator?.full_name ?? '-'}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {r.last_run_at ? formatDateTime(r.last_run_at) : '未実行'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right text-xs tabular-nums">
                      {r.last_run_row_count?.toLocaleString() ?? '-'}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
