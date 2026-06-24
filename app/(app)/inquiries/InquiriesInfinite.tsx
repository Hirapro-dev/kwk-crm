'use client';

import { type InfiniteCol, InfiniteTable } from '@/components/layout/InfiniteTable';
import { PhoneLink } from '@/components/layout/PhoneLink';
import { Badge } from '@/components/ui/badge';
import { TableCell } from '@/components/ui/table';
import type { InquiryListItem } from '@/lib/domain/inquiries';
import { LIST_PAGE_SIZE } from '@/lib/domain/list_constants';
import { loadMoreInquiries } from '@/lib/domain/list_more_actions';
import { formatDate } from '@/lib/utils/date';
import Link from 'next/link';

interface Props {
  initialRows: InquiryListItem[];
  total: number;
  params: {
    q?: string;
    formId?: number;
    unassigned?: boolean;
    sort?: string;
    dir?: 'asc' | 'desc';
  };
}

const COLUMNS: InfiniteCol[] = [
  { header: '問合せID', sortField: 'id' },
  { header: '登録日時', sortField: 'registered_at' },
  { header: 'フォーム名', sortField: 'form_id' },
  { header: '氏名', sortField: 'name' },
  { header: 'メールアドレス', sortField: 'email' },
  { header: '電話番号', sortField: 'phone' },
];

export function InquiriesInfinite({ initialRows, total, params }: Props) {
  const renderRow = (r: InquiryListItem) => (
    <>
      <TableCell className="whitespace-nowrap font-mono text-xs">
        <Link href={`/inquiries/${r.id}`} className="text-primary hover:underline">
          {r.id}
        </Link>
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs">{formatDate(r.registered_at)}</TableCell>
      <TableCell className="text-xs">
        {r.form ? (
          <>
            {r.form.category && (
              <Badge variant="outline" className="mr-1 whitespace-nowrap">
                {r.form.category}
              </Badge>
            )}
            <span className="whitespace-nowrap">{r.form.name}</span>
          </>
        ) : (
          '-'
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {r.name ? (
          r.member ? (
            <Link href={`/members/${r.member.id}`} className="text-primary hover:underline">
              {r.name}
            </Link>
          ) : (
            r.name
          )
        ) : (
          '-'
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs">{r.email ?? '-'}</TableCell>
      <TableCell className="whitespace-nowrap text-xs">
        <PhoneLink value={r.phone} />
      </TableCell>
    </>
  );

  return (
    <InfiniteTable
      initialRows={initialRows}
      total={total}
      pageSize={LIST_PAGE_SIZE}
      loadMore={(page) => loadMoreInquiries(params, page)}
      columns={COLUMNS}
      renderRow={renderRow}
      getKey={(r) => r.id}
      emptyMessage="該当する問合せがありません"
    />
  );
}
