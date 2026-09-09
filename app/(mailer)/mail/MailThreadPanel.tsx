/**
 * メールスレッドの表示(仕様書 §5.15 / §8.1)
 *
 * /mail/[id] から使うサーバーコンポーネント。
 * - メッセージを古い順に並べる(受信/送信を色分け)
 * - 担当・ステータス・会員紐付けの操作は MailThreadControls(クライアント)
 * - 本文は MailBodyViewer(HTML 版を既定表示。サンドボックス iframe + 画像は明示操作でのみ読み込み)
 * - 添付は短期署名 URL(サーバー側で発行)
 */

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/domain/auth';
import { getMailAttachmentSignedUrl, getMailThread } from '@/lib/domain/mail';
import { listAllUsers } from '@/lib/domain/users_admin';
import { getMailAwsConfig } from '@/lib/mail/aws';
import { domainOf, isDomainSendable } from '@/lib/mail/ses_send';
import { formatDateTime } from '@/lib/utils/date';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MailBodyViewer } from './MailBodyViewer';
import { MailReplyForm } from './MailReplyForm';
import { MailThreadControls } from './MailThreadControls';
import { MarkThreadRead } from './MarkThreadRead';

interface Props {
  threadId: string;
  /** 他画面に埋め込む場合(見つからないときに notFound() を出さない) */
  embedded?: boolean;
}

/** 署名 URL の有効期間。画面を開いたまま添付を開く猶予として 10 分 */
const ATTACHMENT_URL_TTL_SEC = 600;

function formatBytes(n: number | null): string {
  if (n === null || n === undefined) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export async function MailThreadPanel({ threadId, embedded }: Props) {
  const [thread, me, users] = await Promise.all([
    getMailThread(threadId),
    getCurrentUser(),
    listAllUsers({ activeOnly: true }),
  ]);

  if (!thread) {
    if (embedded) {
      return <p className="p-4 text-sm text-muted-foreground">スレッドが見つかりません。</p>;
    }
    notFound();
  }

  const assigneeOptions = users.map((u) => ({ id: u.id, name: u.full_name ?? u.email }));
  const canEdit = me.role !== 'viewer';

  // 送信可否: SES でドメイン検証済みの受信箱だけ返信できる(M2)
  const cfg = getMailAwsConfig();
  const boxDomain = thread.mail_box ? domainOf(thread.mail_box.address) : null;
  const sendable =
    !!cfg &&
    !!boxDomain &&
    !!thread.mail_box?.is_active &&
    (await isDomainSendable(cfg, boxDomain));
  const disabledReason = !cfg
    ? '送信基盤(SES)が未設定です。'
    : `送信元ドメイン ${boxDomain ?? ''} が SES で未検証です。検証(DKIM 設定)後に送信できるようになります。`;
  const lastInbound = [...thread.messages].reverse().find((m) => m.direction === 'in');

  // 添付の署名 URL をまとめて発行
  const signedUrls = new Map<string, string>();
  await Promise.all(
    thread.messages.flatMap((m) =>
      (m.attachments ?? []).map(async (a) => {
        const url = await getMailAttachmentSignedUrl(a.storage_path, ATTACHMENT_URL_TTL_SEC);
        if (url) signedUrls.set(a.id, url);
      }),
    ),
  );

  return (
    <div className="space-y-3">
      {/* 開いたら既読にする(閲覧専用ロールは対象外) */}
      {canEdit && !thread.is_read && <MarkThreadRead threadId={thread.id} />}

      <Card className="overflow-hidden p-0 shadow-sm">
        <CardHeader className="border-b py-3">
          <CardTitle className="text-base">{thread.subject || '(件名なし)'}</CardTitle>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>受信箱: {thread.mail_box?.address ?? '-'}</span>
            <span>
              会員:{' '}
              {thread.member ? (
                <Link href={`/members/${thread.member.id}`} className="sf-link">
                  {thread.member.name}({thread.member.id})
                </Link>
              ) : (
                '未紐付け'
              )}
            </span>
            <span>{thread.messages.length} 通</span>
            {!sendable && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                受信専用
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-3">
          <MailThreadControls
            threadId={thread.id}
            status={thread.status}
            category={thread.category}
            assigneeId={thread.assignee_id}
            memberId={thread.member_id}
            assigneeOptions={assigneeOptions}
            canEdit={canEdit}
          />
        </CardContent>
      </Card>

      {thread.messages.map((m) => {
        const isOut = m.direction === 'out';
        const fromLabel = isOut
          ? `${m.sender?.full_name ?? '(送信者不明)'} <${m.from_address}>`
          : m.from_name
            ? `${m.from_name} <${m.from_address}>`
            : m.from_address;
        return (
          <Card
            key={m.id}
            className={`overflow-hidden p-0 shadow-sm ${isOut ? 'border-l-4 border-l-blue-400' : 'border-l-4 border-l-emerald-400'}`}
          >
            <CardHeader className="border-b bg-gray-50 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-[11px]">
                    {isOut ? '送信' : '受信'}
                  </Badge>
                  <span className="font-medium">{fromLabel}</span>
                  {isOut && m.delivery_status && (
                    <span
                      className={
                        m.delivery_status === 'bounced' || m.delivery_status === 'failed'
                          ? 'text-red-600'
                          : 'text-muted-foreground'
                      }
                    >
                      配信: {m.delivery_status}
                    </span>
                  )}
                </div>
                <time dateTime={m.sent_at ?? m.created_at} className="text-muted-foreground">
                  {formatDateTime(m.sent_at ?? m.created_at)}
                </time>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                宛先: {m.to_addresses.join(', ') || '-'}
                {m.cc_addresses.length > 0 && <> / CC: {m.cc_addresses.join(', ')}</>}
              </div>
            </CardHeader>
            <CardContent className="px-3 py-3">
              <MailBodyViewer text={m.text_body} html={m.html_body} />

              {m.attachments && m.attachments.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2 border-t pt-2 text-xs">
                  {m.attachments.map((a) => {
                    const url = signedUrls.get(a.id);
                    return (
                      <li key={a.id}>
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="sf-link rounded border px-2 py-1"
                          >
                            📎 {a.filename}{' '}
                            <span className="text-muted-foreground">
                              {formatBytes(a.size_bytes)}
                            </span>
                          </a>
                        ) : (
                          <span className="rounded border px-2 py-1 text-muted-foreground">
                            📎 {a.filename}(取得不可)
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        );
      })}

      {canEdit && (
        <MailReplyForm
          threadId={thread.id}
          replyTo={lastInbound?.from_address ?? null}
          sendable={sendable}
          disabledReason={disabledReason}
          signature={thread.mail_box?.signature ?? null}
          defaultFromName={thread.mail_box?.display_name ?? null}
        />
      )}
    </div>
  );
}
