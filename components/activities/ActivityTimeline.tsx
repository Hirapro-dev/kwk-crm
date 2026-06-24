import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ActivityListItem } from '@/lib/domain/types';
import { formatDateTime } from '@/lib/utils/date';

/**
 * 対応歴を表形式で表示する。
 *
 * 仕様 (2026-05 確定):
 *   カラム: 日時 / 対応者 / 接触種別 / 接触内容 / 状態 / 対応詳細
 *   - s_bunrui (状態) は ActivityForm で「通電|不在|接触対応」のパイプ区切り文字列が
 *     格納されている想定 (古いデータは1つの文字列)。
 *   - 対応詳細は1行省略表示、title 属性で全文ホバー表示。
 *   - 横スクロール可能 (overflow-auto + min-width)。
 */
export function ActivityTimeline({ activities }: { activities: ActivityListItem[] }) {
  if (activities.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">対応歴はありません</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[820px]">
        <TableHeader>
          <TableRow className="bg-gray-50 hover:bg-gray-50">
            <TableHead className="h-9 whitespace-nowrap">日時</TableHead>
            <TableHead className="h-9 whitespace-nowrap">対応者</TableHead>
            <TableHead className="h-9 whitespace-nowrap">接触種別</TableHead>
            <TableHead className="h-9 whitespace-nowrap">接触内容</TableHead>
            <TableHead className="h-9 whitespace-nowrap">状態</TableHead>
            <TableHead className="h-9 w-full">対応詳細</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {activities.map((a) => {
            const ts = a.registered_datetime ?? a.created_at;
            const description = a.description ?? '';
            return (
              <TableRow key={a.id} className="sf-row-hover">
                <TableCell className="whitespace-nowrap py-2 text-xs">
                  <time dateTime={ts}>{formatDateTime(ts)}</time>
                </TableCell>
                <TableCell className="whitespace-nowrap py-2 text-sm">
                  {a.owner?.full_name ?? '-'}
                </TableCell>
                <TableCell className="whitespace-nowrap py-2 text-sm">
                  {a.d_bunrui ?? '-'}
                </TableCell>
                <TableCell className="whitespace-nowrap py-2 text-sm">
                  {a.m_bunrui ?? '-'}
                </TableCell>
                <TableCell className="whitespace-nowrap py-2 text-sm">
                  {a.s_bunrui ?? '-'}
                </TableCell>
                <TableCell className="py-2 text-sm text-muted-foreground">
                  {description || '-'}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
