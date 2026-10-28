/**
 * 送信メールの表(1 通ずつ新しい順)と「次の 50 件」(CLAUDE.md §5.15「送信済み・自分の送信履歴」)。
 * 受信箱の「送信済み」タブ(/mail?box=…&tab=sent)と「自分の送信履歴」(/mail/sent?mine=1)で使う。
 */

import { SENT_PAGE_SIZE, sentCursorOf } from '@/lib/domain/mail_sent';
import type { SentMessageRow } from '@/lib/domain/mail_sent_queries';
import { formatDateTime } from '@/lib/utils/date';
import Link from 'next/link';

const DELIVERY_LABEL: Record<string, string> = {
  queued: '送信中',
  sent: '送信済み',
  delivered: '配信済み',
  bounced: '不達',
  failed: '失敗',
};

export function SentMessagesTable({
  rows,
  hasMore,
  error,
  isContinued,
  firstHref,
  nextHref,
  emptyText = '送信したメールはありません',
}: {
  rows: SentMessageRow[];
  hasMore: boolean;
  error?: string;
  /** 続きのページを見ている(「最新に戻る」を出す) */
  isContinued: boolean;
  firstHref: string;
  /** 続き位置からその先の URL を作る */
  nextHref: (before: string) => string;
  emptyText?: string;
}) {
  const last = rows[rows.length - 1];
  return (
    <>
      {error ? (
        <p className="p-6 text-center text-sm text-red-600">
          送信メールを読み込めませんでした: {error}
        </p>
      ) : rows.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">送信日時</th>
                <th className="px-3 py-2 font-medium">件名</th>
                <th className="px-3 py-2 font-medium">宛先</th>
                <th className="px-3 py-2 font-medium">送信元</th>
                <th className="px-3 py-2 font-medium">送信者</th>
                <th className="px-3 py-2 font-medium">配信</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="border-t hover:bg-accent/50">
                  <td className="whitespace-nowrap px-3 py-2">{formatDateTime(m.sent_at)}</td>
                  <td className="max-w-[26rem] truncate px-3 py-2">
                    <Link href={`/mail/${m.thread_id}`} className="sf-link" title={m.subject ?? ''}>
                      {m.subject || '(件名なし)'}
                    </Link>
                  </td>
                  <td className="max-w-[14rem] truncate px-3 py-2 font-mono">
                    {m.to_addresses.join(', ')}
                  </td>
                  <td className="max-w-[14rem] truncate px-3 py-2">{m.from_address}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {m.sender?.full_name ??
                      (m.source === 'import_maildealer' ? (
                        <span className="text-muted-foreground">メールディーラー</span>
                      ) : (
                        ''
                      ))}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {m.delivery_status
                      ? (DELIVERY_LABEL[m.delivery_status] ?? m.delivery_status)
                      : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(isContinued || hasMore) && (
        <div className="flex items-center justify-between border-t px-3 py-2 text-xs">
          {isContinued ? (
            <Link href={firstHref} className="sf-link">
              ← 最新に戻る
            </Link>
          ) : (
            <span />
          )}
          {hasMore && last && (
            <Link href={nextHref(sentCursorOf(last))} className="sf-link">
              次の {SENT_PAGE_SIZE} 件 →
            </Link>
          )}
        </div>
      )}
    </>
  );
}
