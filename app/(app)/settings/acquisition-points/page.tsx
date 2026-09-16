/**
 * /settings/acquisition-points — 顧客情報取得ポイントマスタ(管理者用。CLAUDE.md §5.19)
 * 会員の「個人情報取得ポイント」の選択肢。一覧・追加・行内編集(名前 / 並び順 / 有効)。
 */

import { PanelHeader } from '@/components/layout/PanelHeader';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { listAcquisitionPoints } from '@/lib/domain/masters';
import { NewPointForm } from './NewPointForm';
import { PointRow } from './PointRow';

export default async function SettingsAcquisitionPointsPage() {
  const points = await listAcquisitionPoints();
  const nextSortOrder = (points.reduce((m, p) => Math.max(m, p.sort_order), 0) || 0) + 10;

  return (
    <div className="space-y-3">
      <NewPointForm nextSortOrder={nextSortOrder} />
      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel="PT"
          iconColor="#f59e0b"
          viewName="顧客情報取得ポイントマスタ"
          totalCount={points.length}
        />
        <div className="px-4 py-2 text-xs text-muted-foreground">
          会員の「個人情報取得ポイント」の選択肢です。使わなくなった項目は無効にしてください(削除はしません)。
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50 hover:bg-gray-50">
              <TableHead className="h-9 w-24">並び順</TableHead>
              <TableHead className="h-9">名前</TableHead>
              <TableHead className="h-9 w-16 text-center">有効</TableHead>
              <TableHead className="h-9 w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {points.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                  取得ポイントがありません(migration 96 が未適用の場合は空になります)
                </TableCell>
              </TableRow>
            ) : (
              points.map((p) => <PointRow key={p.id} point={p} />)
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
