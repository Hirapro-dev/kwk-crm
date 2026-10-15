/**
 * 送信待ちメールの詳細(内容の確認と、承認・差し戻し・取消・修正・送り直し)。CLAUDE.md §5.15 / §8.1。
 */

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/domain/auth';
import {
  MAIL_OUTBOX_STATUS_LABELS,
  canApproveOutbox,
  canCancelOutbox,
  canEditOutbox,
  canRejectOutbox,
  canRetryOutbox,
  toScheduledInputValue,
} from '@/lib/domain/mail_outbox';
import { getMailOutbox } from '@/lib/domain/mail_outbox_queries';
import { formatDateTime } from '@/lib/utils/date';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { OutboxActions } from '../../OutboxActions';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MailOutboxDetailPage({ params }: PageProps) {
  const { id } = await params;
  const [me, o] = await Promise.all([getCurrentUser(), getMailOutbox(id)]);
  if (!o) notFound();

  const rows: Array<[string, React.ReactNode]> = [
    ['状態', MAIL_OUTBOX_STATUS_LABELS[o.status]],
    [
      '送信日時',
      o.status === 'sent'
        ? `${formatDateTime(o.sent_at)} 送信`
        : o.scheduled_at
          ? `${formatDateTime(o.scheduled_at)} に予約`
          : '承認されたらすぐ送る',
    ],
    [
      '送信元',
      o.mail_box
        ? `${o.from_name ? `${o.from_name} ` : ''}<${o.mail_box.address}>`
        : String(o.mail_box_id),
    ],
    [
      '宛先',
      <span key="to" className="font-mono">
        {o.to_addresses.join(', ')}
      </span>,
    ],
    ...(o.cc_addresses.length > 0
      ? ([
          [
            'CC',
            <span key="cc" className="font-mono">
              {o.cc_addresses.join(', ')}
            </span>,
          ],
        ] as Array<[string, React.ReactNode]>)
      : []),
    ['作成', `${o.creator?.full_name ?? ''} ${formatDateTime(o.created_at)}`],
  ];
  if (o.approved_at)
    rows.push(['承認', `${o.approver?.full_name ?? ''} ${formatDateTime(o.approved_at)}`]);
  if (o.rejected_at)
    rows.push(['差し戻し', `${o.rejecter?.full_name ?? ''} ${formatDateTime(o.rejected_at)}`]);
  if (o.cancelled_at)
    rows.push(['取消', `${o.canceller?.full_name ?? ''} ${formatDateTime(o.cancelled_at)}`]);

  const perms = {
    approve: canApproveOutbox(me, o),
    reject: canRejectOutbox(me, o),
    cancel: canCancelOutbox(me, o),
    edit: canEditOutbox(me, o),
    retry: canRetryOutbox(me, o),
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/mail/outbox">
          <Button variant="ghost" size="sm">
            ← 送信待ちへ戻る
          </Button>
        </Link>
        {o.thread_id && (
          <Link href={`/mail/${o.thread_id}`}>
            <Button variant="outline" size="sm">
              スレッドを開く
            </Button>
          </Link>
        )}
      </div>
      <Card className="overflow-hidden p-0 shadow-sm">
        <CardHeader className="border-b py-3">
          <CardTitle className="text-base">
            {o.kind === 'reply' ? '返信' : '新規メール'}: {o.subject || '(件名なし)'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4">
          {o.status === 'rejected' && o.reject_reason && (
            <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs">
              <div className="font-semibold text-amber-800">差し戻しの理由</div>
              <p className="whitespace-pre-wrap">{o.reject_reason}</p>
            </div>
          )}
          {o.last_error && (
            <div className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700">
              {o.last_error}
            </div>
          )}
          <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-xs">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="min-w-0 break-all">{v}</dd>
              </div>
            ))}
          </dl>
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded border bg-gray-50 p-3 font-sans text-sm">
            {o.text_body}
          </pre>
          <OutboxActions
            id={o.id}
            kind={o.kind}
            perms={perms}
            initial={{
              body: o.text_body,
              cc: o.cc_addresses.join(', '),
              to: o.to_addresses.join(', '),
              subject: o.subject,
              fromName: o.from_name ?? '',
              scheduledAt: toScheduledInputValue(o.status === 'sent' ? null : o.scheduled_at),
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
