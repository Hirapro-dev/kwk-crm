'use client';

import { type InfiniteCol, InfiniteTable } from '@/components/layout/InfiniteTable';
import { Badge } from '@/components/ui/badge';
import { TableCell } from '@/components/ui/table';
import { LIST_PAGE_SIZE } from '@/lib/domain/list_constants';
import { loadMoreMailThreads } from '@/lib/domain/list_more_actions';
import type { MailCategory, MailStatus, MailThreadListItem } from '@/lib/domain/mail_types';
import { formatDateTime } from '@/lib/utils/date';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

/**
 * メーラーのスレッド一覧(無限スクロール)。CLAUDE.md §5.15 / §8.1
 * メールディーラーの一覧に合わせ、列は 状態 / 件名 / From / 受信箱 / 日付 / 担当。
 * 件名クリックでスレッド画面へ(一覧の絞り込みを URL で引き継ぎ、前後移動に使う)。未読は太字。
 */
interface Props {
  initialRows: MailThreadListItem[];
  total: number;
  params: {
    q?: string;
    status?: MailStatus;
    category?: MailCategory;
    assigneeId?: string;
    mailBoxId?: number;
    unreadOnly?: boolean;
  };
  /** 「すべての受信箱」表示のとき受信箱列を出す */
  showBoxColumn?: boolean;
  /** mail_box_id → アドレス(受信箱列の表示用) */
  boxAddresses?: Record<number, string>;
}

const STATUS_CLASS: Record<MailStatus, string> = {
  未対応: 'bg-red-100 text-red-800 border-red-200',
  対応中: 'bg-amber-100 text-amber-800 border-amber-200',
  完了: 'bg-gray-100 text-gray-700 border-gray-200',
};

export function MailInfinite({ initialRows, total, params, showBoxColumn, boxAddresses }: Props) {
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const columns: InfiniteCol[] = [
    { header: '状態', headClassName: 'w-28' },
    { header: '件名' },
    { header: 'From', headClassName: 'w-64' },
    ...(showBoxColumn ? [{ header: '受信箱', headClassName: 'w-48' }] : []),
    { header: '日付', headClassName: 'w-36' },
    { header: '担当', headClassName: 'w-28' },
  ];

  const renderRow = (t: MailThreadListItem) => {
    const href = qs ? `/mail/${t.id}?${qs}` : `/mail/${t.id}`;
    const unread = !t.is_read;
    const from = t.last_from_name
      ? `${t.last_from_name} <${t.last_from_address ?? ''}>`
      : (t.last_from_address ?? '-');
    const cells = [
      <TableCell key="status" className="whitespace-nowrap py-2">
        <Badge variant="outline" className={`text-[11px] ${STATUS_CLASS[t.status] ?? ''}`}>
          {t.status}
        </Badge>
        {t.last_direction === 'in' && t.status !== '完了' && (
          <span className="ml-1 text-[10px] text-red-600" title="顧客からのメールが最後">
            ●
          </span>
        )}
      </TableCell>,
      <TableCell key="subject" className="max-w-[480px] py-2 text-sm">
        <Link
          href={href}
          className={`sf-link block truncate ${unread ? 'font-semibold' : ''}`}
          title={t.subject ?? ''}
        >
          {t.subject || '(件名なし)'}
        </Link>
        {t.member && (
          <span className="block truncate text-[11px] text-muted-foreground">
            会員: {t.member.name}({t.member.id})
          </span>
        )}
      </TableCell>,
      <TableCell
        key="from"
        className={`max-w-[260px] truncate py-2 text-xs ${unread ? 'font-semibold' : ''}`}
        title={from}
      >
        {from}
      </TableCell>,
    ];
    if (showBoxColumn) {
      cells.push(
        <TableCell
          key="box"
          className="max-w-[200px] truncate py-2 text-xs text-muted-foreground"
          title={boxAddresses?.[t.mail_box_id] ?? ''}
        >
          {boxAddresses?.[t.mail_box_id] ?? '-'}
        </TableCell>,
      );
    }
    cells.push(
      <TableCell key="last" className="whitespace-nowrap py-2 text-xs">
        {formatDateTime(t.last_message_at)}
      </TableCell>,
      <TableCell key="assignee" className="whitespace-nowrap py-2 text-xs">
        {t.assignee?.full_name ?? <span className="text-muted-foreground">--</span>}
      </TableCell>,
    );
    return cells;
  };

  return (
    <InfiniteTable<MailThreadListItem>
      initialRows={initialRows}
      total={total}
      pageSize={LIST_PAGE_SIZE}
      loadMore={(page) => loadMoreMailThreads(params, page)}
      columns={columns}
      renderRow={renderRow}
      getKey={(t) => t.id}
      emptyMessage="該当するメールがありません"
      fillParent
      rowClassName={(t) => (t.is_read ? 'sf-row-hover' : 'sf-row-hover bg-orange-50/40')}
    />
  );
}
