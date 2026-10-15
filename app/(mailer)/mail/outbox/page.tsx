/**
 * 送信待ちメールの一覧(承認待ち・予約中・差し戻し・送信失敗・送信済み・取消)。CLAUDE.md §5.15 / §8.1。
 * 左フォルダの固定項目「送信待ち」から開く。行をクリックすると内容の確認と承認・差し戻しの画面へ。
 */

import { Card } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/domain/auth';
import {
  MAIL_OUTBOX_STATUS_LABELS,
  MAIL_OUTBOX_TABS,
  isMailApprover,
  outboxTabStatuses,
  resolveOutboxTab,
} from '@/lib/domain/mail_outbox';
import { countMailOutboxByStatus, listMailOutbox } from '@/lib/domain/mail_outbox_queries';
import { cn } from '@/lib/utils/cn';
import { formatDateTime } from '@/lib/utils/date';
import Link from 'next/link';

interface PageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function MailOutboxPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const tab = resolveOutboxTab(sp.tab);
  const [me, items, counts] = await Promise.all([
    getCurrentUser(),
    listMailOutbox(outboxTabStatuses(tab)),
    countMailOutboxByStatus(),
  ]);
  const tabCount = (key: string): number | null => {
    const t = MAIL_OUTBOX_TABS.find((x) => x.key === key);
    if (!t || key === 'sent' || key === 'cancelled') return null;
    return t.statuses.reduce((n, s) => n + (counts[s] ?? 0), 0);
  };

  return (
    <Card className="overflow-hidden p-0 shadow-sm">
      <div className="border-b px-3 py-2">
        <h1 className="text-base font-semibold">送信待ち</h1>
        <p className="text-xs text-muted-foreground">
          メーラーから送るメールは、承認者(admin / manager)が承認したときに送信されます。
          {isMailApprover(me.role)
            ? '自分が作成したメールは、ほかの承認者が承認します。'
            : '差し戻されたメールは、内容を直して承認依頼を出し直せます。'}
        </p>
      </div>
      <div className="flex items-center gap-1 overflow-x-auto border-b px-2 py-1.5">
        {MAIL_OUTBOX_TABS.map((t) => {
          const active = t.key === tab;
          const n = tabCount(t.key);
          return (
            <Link
              key={t.key}
              href={t.key === 'pending' ? '/mail/outbox' : `/mail/outbox?tab=${t.key}`}
              className={cn(
                'flex items-center gap-1.5 whitespace-nowrap rounded px-2.5 py-1 text-xs',
                active
                  ? 'bg-primary/10 font-semibold text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
              aria-current={active ? 'page' : undefined}
            >
              {t.label}
              {n !== null && (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] leading-none',
                    t.key === 'pending' && n > 0
                      ? 'bg-orange-500 font-semibold text-white'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {n}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {items.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">該当するメールはありません</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">状態</th>
                <th className="px-3 py-2 font-medium">送信日時</th>
                <th className="px-3 py-2 font-medium">件名</th>
                <th className="px-3 py-2 font-medium">宛先</th>
                <th className="px-3 py-2 font-medium">送信元</th>
                <th className="px-3 py-2 font-medium">作成者</th>
                <th className="px-3 py-2 font-medium">作成日時</th>
              </tr>
            </thead>
            <tbody>
              {items.map((o) => (
                <tr key={o.id} className="border-t hover:bg-accent/50">
                  <td className="whitespace-nowrap px-3 py-2">
                    {MAIL_OUTBOX_STATUS_LABELS[o.status]}
                    {o.kind === 'new' && (
                      <span className="ml-1 rounded bg-muted px-1 text-[10px]">新規</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {o.status === 'sent'
                      ? formatDateTime(o.sent_at)
                      : o.scheduled_at
                        ? `${formatDateTime(o.scheduled_at)} 予約`
                        : '承認後すぐ'}
                  </td>
                  <td className="max-w-[24rem] truncate px-3 py-2">
                    <Link href={`/mail/outbox/${o.id}`} className="sf-link">
                      {o.subject || '(件名なし)'}
                    </Link>
                  </td>
                  <td className="max-w-[14rem] truncate px-3 py-2 font-mono">
                    {o.to_addresses.join(', ')}
                  </td>
                  <td className="max-w-[14rem] truncate px-3 py-2">{o.mail_box?.address ?? ''}</td>
                  <td className="whitespace-nowrap px-3 py-2">{o.creator?.full_name ?? ''}</td>
                  <td className="whitespace-nowrap px-3 py-2">{formatDateTime(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
