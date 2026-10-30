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
import {
  getMailAttachmentSignedUrl,
  getMailThread,
  listMailBoxes,
  listMailImportRules,
  listMailSignatures,
} from '@/lib/domain/mail';
import { splitVisibleAttachments } from '@/lib/domain/mail_attachment_view';
import { buildReplySubject, findAddressesInText } from '@/lib/domain/mail_compose';
import { splitOtherMailBox } from '@/lib/domain/mail_folders';
import { findMatchingRule, mailBodyText } from '@/lib/domain/mail_import_rules';
import { MAIL_OUTBOX_STATUS_LABELS, canDirectSend } from '@/lib/domain/mail_outbox';
import { listThreadOutbox } from '@/lib/domain/mail_outbox_queries';
import { buildThreadQuoteHtml } from '@/lib/domain/mail_quote_html';
import { buildThreadQuote } from '@/lib/domain/mail_text';
import { listFieldDefinitions } from '@/lib/domain/object_metadata';
import { listAllUsers } from '@/lib/domain/users_admin';
import { getMailAwsConfig } from '@/lib/mail/aws';
import { domainOf, isDomainSendable, sendableDomainMap } from '@/lib/mail/ses_send';
import { formatDateTime } from '@/lib/utils/date';
import { Paperclip } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MailAttachmentList } from './MailAttachmentList';
import { MailBodyViewer } from './MailBodyViewer';
import { MailImportRulePanel } from './MailImportRulePanel';
import { MailReplyForm } from './MailReplyForm';
import { MailThreadControls } from './MailThreadControls';
import { MarkThreadRead } from './MarkThreadRead';

interface Props {
  threadId: string;
  /** 他画面に埋め込む場合(見つからないときに notFound() を出さない) */
  embedded?: boolean;
  /**
   * 返信フォームを出すか(既定 true)。取込候補(§5.16)から開いたときは false にし、
   * 返信ではなく取込ルールの設定だけを行う画面にする。
   */
  showReply?: boolean;
}

/** 署名 URL の有効期間。画面を開いたまま添付を開く猶予として 10 分 */
const ATTACHMENT_URL_TTL_SEC = 600;

export async function MailThreadPanel({ threadId, embedded, showReply = true }: Props) {
  const [thread, me, users, allBoxes, allSignatures, outbox] = await Promise.all([
    getMailThread(threadId),
    getCurrentUser(),
    listAllUsers({ activeOnly: true }),
    listMailBoxes(),
    listMailSignatures(),
    // このスレッドの送信待ち(承認待ち・予約中など。migration 124)
    listThreadOutbox(threadId),
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

  // 返信フォームの送信元候補(有効な受信箱すべて。「その他」は除く。送信可否はドメインの SES 検証状態)。
  // ドメインごとに 1 回だけ調べる(受信箱ごとに同時に問い合わせると SES に断られ、検証済みでも「受信専用」になっていた)
  const activeBoxes = splitOtherMailBox(allBoxes).rest.filter((b) => b.is_active);
  const sendableByDomain = cfg
    ? await sendableDomainMap(
        cfg,
        activeBoxes.map((b) => b.address),
      )
    : new Map<string, boolean>();
  const fromOptions = activeBoxes.map((b) => {
    const d = domainOf(b.address);
    return {
      id: b.id,
      address: b.address,
      display_name: b.display_name,
      default_signature_id: b.default_signature_id,
      sendable: !!d && sendableByDomain.get(d) === true,
    };
  });
  // 返信先の候補: 直近の受信メールの本文にあるアドレス(フォーム通知の「メール : …」など。差出人と自社の受信箱は除く)
  const replyToCandidates = lastInbound
    ? findAddressesInText(mailBodyText(lastInbound.text_body, lastInbound.html_body), [
        lastInbound.from_address,
        ...allBoxes.map((b) => b.address),
      ])
    : [];
  // 返信に付ける引用: スレッドのやり取り全部を新しい順に(2026-10-20。各メールの中の既存の引用は外す)。
  // テキスト版と HTML 版(2026-10-30)。フォームではプレビューだけで、送るときはサーバーが同じ関数で作り直す
  const initialQuote = buildThreadQuote(thread.messages);
  const initialQuoteHtml = buildThreadQuoteHtml(thread.messages);

  // 取込候補から開いたとき(showReply=false)は、返信の代わりに取込ルール(§5.16)のパネルを出す。
  // このメールに一致するルールがあれば編集、無ければ新規作成になる。
  const importRuleSample =
    !showReply && lastInbound
      ? {
          mailBoxId: thread.mail_box_id,
          mailBoxAddress: thread.mail_box?.address ?? null,
          fromAddress: lastInbound.from_address,
          subject: lastInbound.subject ?? thread.subject ?? '',
          textBody: lastInbound.text_body,
          htmlBody: lastInbound.html_body,
        }
      : null;
  const importRules = importRuleSample ? await listMailImportRules() : [];
  const matchingImportRule = importRuleSample
    ? findMatchingRule(importRules, {
        mailBoxId: importRuleSample.mailBoxId,
        fromAddress: importRuleSample.fromAddress,
        subject: importRuleSample.subject,
        textBody: importRuleSample.textBody,
        htmlBody: importRuleSample.htmlBody,
      })
    : null;
  // 「入れる項目」の選択肢: 問合せの全項目(項目管理の定義。空白セルは除く)
  const inquiryFields = importRuleSample
    ? (await listFieldDefinitions('inquiries', 'detail'))
        .filter((f) => !f.is_placeholder)
        .map((f) => ({ field_name: f.field_name, label: f.label, is_in_db: f.is_in_db }))
    : [];

  // スレッド全体の添付ファイルの数(電子署名などの部品は数えない)
  const threadFileCount = thread.messages.reduce(
    (n, m) => n + splitVisibleAttachments(m.attachments ?? []).files.length,
    0,
  );

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
            {threadFileCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded bg-sky-600 px-1.5 py-0.5 font-semibold text-white">
                <Paperclip className="h-3 w-3" aria-hidden="true" />
                添付 {threadFileCount} 件
              </span>
            )}
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

      {/* メッセージは新しい順に並べる(2026-10-20 ユーザー要望。取得は古い順なので逆にする) */}
      {[...thread.messages].reverse().map((m) => {
        const isOut = m.direction === 'out';
        const fileCount = splitVisibleAttachments(m.attachments ?? []).files.length;
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
                  {fileCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded bg-sky-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                      <Paperclip className="h-3 w-3" aria-hidden="true" />
                      添付 {fileCount}
                    </span>
                  )}
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
              <MailAttachmentList attachments={m.attachments ?? []} signedUrls={signedUrls} />
              <MailBodyViewer text={m.text_body} html={m.html_body} />
            </CardContent>
          </Card>
        );
      })}

      {importRuleSample && lastInbound && (
        <MailImportRulePanel
          sample={importRuleSample}
          existingRule={matchingImportRule}
          allRules={importRules}
          threadId={thread.id}
          isAdmin={me.role === 'admin'}
          inquiryFields={inquiryFields}
          messageRowId={lastInbound.id}
          importStatus={lastInbound.import_status ?? null}
          importNote={lastInbound.import_note ?? null}
          inquiryId={lastInbound.inquiry_id ?? null}
          lpEntryId={lastInbound.lp_entry_id ?? null}
        />
      )}

      {outbox.length > 0 && (
        <Card className="overflow-hidden border-amber-300 p-0 shadow-sm">
          <CardHeader className="border-b bg-amber-50 py-2">
            <CardTitle className="text-sm">送信待ちの返信({outbox.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 p-2">
            {outbox.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="outline">{MAIL_OUTBOX_STATUS_LABELS[o.status]}</Badge>
                <span className="text-muted-foreground">
                  {o.scheduled_at ? `${formatDateTime(o.scheduled_at)} に予約` : '承認後すぐ送信'}
                </span>
                <span className="text-muted-foreground">
                  作成 {o.creator?.full_name ?? ''} {formatDateTime(o.created_at)}
                </span>
                <Link href={`/mail/outbox/${o.id}`} className="sf-link">
                  内容を確認
                </Link>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {canEdit && showReply && (
        <MailReplyForm
          threadId={thread.id}
          replyTo={lastInbound?.from_address ?? null}
          replyToCandidates={replyToCandidates}
          sendable={sendable}
          disabledReason={disabledReason}
          defaultBoxId={thread.mail_box_id}
          boxes={fromOptions}
          signatures={allSignatures.filter((s) => s.is_active)}
          initialQuote={initialQuote}
          initialQuoteHtml={initialQuoteHtml}
          replySubject={buildReplySubject(thread.subject ?? lastInbound?.subject)}
          canDirectSend={canDirectSend(me.role)}
        />
      )}
    </div>
  );
}
