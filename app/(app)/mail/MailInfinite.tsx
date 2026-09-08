'use client';

import { type InfiniteCol, InfiniteTable } from '@/components/layout/InfiniteTable';
import { Badge } from '@/components/ui/badge';
import { TableCell } from '@/components/ui/table';
import { LIST_PAGE_SIZE } from '@/lib/domain/list_constants';
import { loadMoreMailThreads } from '@/lib/domain/list_more_actions';
import type { MailCategory, MailStatus, MailThreadListItem } from '@/lib/domain/mail_types';
import { formatDateTime } from '@/lib/utils/date';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * メール受信箱のスレッド一覧(無限スクロール)。CLAUDE.md §5.15 / §8.1
 * 他の一覧と同じ InfiniteTable を使う。件名クリックでスレッド画面へ
 * (分割ビューでは右ペインに表示)。
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
  /** 分割ビュー: 件名クリックで右ペインにスレッドを出す */
  splitMode?: boolean;
  /** 分割ビューで現在選択中のスレッドID */
  selectedId?: string;
}

const STATUS_CLASS: Record<MailStatus, string> = {
  未対応: 'bg-red-100 text-red-800 border-red-200',
  対応中: 'bg-amber-100 text-amber-800 border-amber-200',
  完了: 'bg-gray-100 text-gray-700 border-gray-200',
};

export function MailInfinite({ initialRows, total, params, splitMode, selectedId }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // 分割ビューで選択スレッドだけ差し替えるリンク(他の条件は維持)
  const buildSelectHref = (id: string) => {
    const p = new URLSearchParams(searchParams.toString());
    p.set('view', 'split');
    p.set('selected', id);
    return `${pathname}?${p.toString()}`;
  };

  const columns: InfiniteCol[] = [
    { header: '状態' },
    { header: '件名' },
    { header: '差出人' },
    { header: '会員' },
    { header: '担当' },
    { header: '最終メール' },
  ];

  const renderRow = (t: MailThreadListItem) => {
    const href = splitMode ? buildSelectHref(t.id) : `/mail/${t.id}`;
    const unread = !t.is_read;
    const from = t.last_from_name
      ? `${t.last_from_name} <${t.last_from_address ?? ''}>`
      : (t.last_from_address ?? '-');
    return [
      <TableCell key="status" className="whitespace-nowrap py-2">
        <Badge variant="outline" className={`text-[11px] ${STATUS_CLASS[t.status] ?? ''}`}>
          {t.status}
        </Badge>
        {t.category !== '通常' && (
          <Badge variant="outline" className="ml-1 text-[10px] text-muted-foreground">
            {t.category}
          </Badge>
        )}
        {t.last_direction === 'in' && t.status !== '完了' && (
          <span className="ml-1 text-[10px] text-red-600" title="顧客からのメールが最後">
            ●
          </span>
        )}
      </TableCell>,
      <TableCell key="subject" className="max-w-[420px] py-2 text-sm">
        <Link
          href={href}
          scroll={!splitMode}
          replace={splitMode}
          className={`sf-link block truncate ${unread ? 'font-semibold' : ''}`}
          title={t.subject ?? ''}
        >
          {t.subject || '(件名なし)'}
        </Link>
      </TableCell>,
      <TableCell key="from" className="max-w-[260px] truncate py-2 text-xs" title={from}>
        {from}
      </TableCell>,
      <TableCell key="member" className="whitespace-nowrap py-2 text-xs">
        {t.member ? (
          <Link href={`/members/${t.member.id}`} className="sf-link">
            {t.member.name}
          </Link>
        ) : (
          <span className="text-muted-foreground">未紐付け</span>
        )}
      </TableCell>,
      <TableCell key="assignee" className="whitespace-nowrap py-2 text-xs">
        {t.assignee?.full_name ?? <span className="text-muted-foreground">未割当</span>}
      </TableCell>,
      <TableCell key="last" className="whitespace-nowrap py-2 text-xs">
        {formatDateTime(t.last_message_at)}
      </TableCell>,
    ];
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
      fillParent={splitMode}
      rowClassName={(t) =>
        splitMode && selectedId === t.id ? 'sf-row-hover bg-primary/10' : 'sf-row-hover'
      }
    />
  );
}
