'use client';

import { type InfiniteCol, InfiniteTable } from '@/components/layout/InfiniteTable';
import { Badge } from '@/components/ui/badge';
import { TableCell } from '@/components/ui/table';
import type { AppStatus, ApplicationListItem } from '@/lib/domain/applications';
import { LIST_PAGE_SIZE } from '@/lib/domain/list_constants';
import { loadMoreApplications } from '@/lib/domain/list_more_actions';
import { formatDate } from '@/lib/utils/date';
import Link from 'next/link';

interface Props {
  initialRows: ApplicationListItem[];
  total: number;
  params: {
    q?: string;
    projectId?: number;
    status?: string;
    sort?: string;
    dir?: 'asc' | 'desc';
  };
}

const STATUS_VARIANT: Record<AppStatus, 'default' | 'secondary' | 'outline' | 'success'> = {
  対応中: 'default',
  未購入: 'outline',
  完了: 'success',
  出金: 'secondary',
  資金移動: 'secondary',
};

const COLUMNS: InfiniteCol[] = [
  { header: '申込ID', sortField: 'id' },
  { header: '申込日', sortField: 'application_date' },
  { header: '会員', sortField: 'member_id' },
  { header: '案件', sortField: 'project_id' },
  { header: 'ステータス', sortField: 'status' },
  { header: '区分', sortField: 'flow_type' },
  {
    header: '入金額',
    sortField: 'payment_amount',
    headClassName: 'h-9 whitespace-nowrap text-right',
  },
  { header: '担当', sortField: 'owner_id' },
];

export function ApplicationsInfinite({ initialRows, total, params }: Props) {
  const renderRow = (a: ApplicationListItem) => (
    <>
      <TableCell className="font-mono text-xs">
        <Link href={`/applications/${a.id}`} className="text-primary hover:underline">
          {a.id}
        </Link>
      </TableCell>
      <TableCell className="text-xs">{formatDate(a.application_date)}</TableCell>
      <TableCell className="text-sm">
        {a.member ? (
          <Link href={`/members/${a.member.id}`} className="text-primary hover:underline">
            {a.member.name}
          </Link>
        ) : (
          '-'
        )}
      </TableCell>
      <TableCell className="text-sm">{a.project ? a.project.name : '-'}</TableCell>
      <TableCell>
        {a.status ? <Badge variant={STATUS_VARIANT[a.status]}>{a.status}</Badge> : '-'}
      </TableCell>
      <TableCell className="text-xs">{a.flow_type ?? '-'}</TableCell>
      <TableCell className="text-right tabular-nums text-sm">
        {a.payment_amount !== null ? `¥${Number(a.payment_amount).toLocaleString()}` : '-'}
      </TableCell>
      <TableCell className="text-sm">{a.owner?.full_name ?? '-'}</TableCell>
    </>
  );

  return (
    <InfiniteTable
      initialRows={initialRows}
      total={total}
      pageSize={LIST_PAGE_SIZE}
      loadMore={(page) => loadMoreApplications(params, page)}
      columns={COLUMNS}
      renderRow={renderRow}
      getKey={(a) => a.id}
      emptyMessage="該当する申込がありません"
    />
  );
}
