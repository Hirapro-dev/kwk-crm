/**
 * 「送信済み」「自分の送信履歴」(CLAUDE.md §5.15 / §8.1。2026-10-28 ユーザー要望)。
 * 送ったメールが「対応完了」の中に埋もれないよう、送信メールだけを 1 通ずつ新しい順に並べる。行をクリックするとそのスレッドを開く。
 * - 送信済み(/mail/sent): すべての送信メール(メールディーラーから取り込んだ過去分を含む)
 * - 自分の送信履歴(/mail/sent?mine=1): 自分が CRM から送ったメール(メールディーラー分は送信者の記録が無いため出ない)
 */

import { Card } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/domain/auth';
import {
  SENT_PAGE_SIZE,
  parseSentCursor,
  sentCursorOf,
  sentFolderHref,
} from '@/lib/domain/mail_sent';
import { listSentMessages } from '@/lib/domain/mail_sent_queries';
import { formatDateTime } from '@/lib/utils/date';
import Link from 'next/link';

interface PageProps {
  searchParams: Promise<{ mine?: string; before?: string }>;
}

const DELIVERY_LABEL: Record<string, string> = {
  queued: '送信中',
  sent: '送信済み',
  delivered: '配信済み',
  bounced: '不達',
  failed: '失敗',
};

export default async function MailSentPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const mine = sp.mine === '1';
  const me = await getCurrentUser();
  const before = parseSentCursor(sp.before);
  const { rows, hasMore, error } = await listSentMessages({
    senderUserId: mine ? me.id : undefined,
    before,
    limit: SENT_PAGE_SIZE,
  });
  const last = rows[rows.length - 1];

  return (
    <Card className="overflow-hidden p-0 shadow-sm">
      <div className="border-b px-3 py-2">
        <h1 className="text-base font-semibold">{mine ? '自分の送信履歴' : '送信済み'}</h1>
        <p className="text-xs text-muted-foreground">
          {mine
            ? '自分が CRM から送ったメールです(新しい順)。メールディーラーで送った過去のメールは、送信者の記録が無いためここには出ません。'
            : '送ったメールです(新しい順。メールディーラーから取り込んだ過去の送信も含みます)。件名をクリックするとスレッドを開きます。'}
        </p>
      </div>

      {error ? (
        <p className="p-6 text-center text-sm text-red-600">
          送信メールを読み込めませんでした: {error}
        </p>
      ) : rows.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">送信したメールはありません</p>
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

      {(before || hasMore) && (
        <div className="flex items-center justify-between border-t px-3 py-2 text-xs">
          {before ? (
            <Link href={sentFolderHref({ mine })} className="sf-link">
              ← 最新に戻る
            </Link>
          ) : (
            <span />
          )}
          {hasMore && last && (
            <Link href={sentFolderHref({ mine, before: sentCursorOf(last) })} className="sf-link">
              次の {SENT_PAGE_SIZE} 件 →
            </Link>
          )}
        </div>
      )}
    </Card>
  );
}
