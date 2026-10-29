'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { groupAddressesByDomain } from '@/lib/domain/mail_folders';
import type { MailSendMode } from '@/lib/domain/mail_outbox';
import { replyToMailThread } from '@/lib/domain/mail_send_actions';
import {
  type SignatureOption,
  defaultSignatureValue,
  signatureBodyOf,
} from '@/lib/domain/mail_signatures';
import { composeOutgoingBody } from '@/lib/domain/mail_text';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  MailAttachmentField,
  attachmentBlockReason,
  attachmentsToSend,
  bodyFileHandlers,
  useMailAttachments,
} from './MailAttachments';
import { ScheduleField, SendModeField } from './ScheduleField';
import { SendConfirmDialog } from './SendConfirmDialog';

export interface ReplyBoxOption {
  id: number;
  address: string;
  display_name: string | null;
  /** 既定の署名(mail_signatures.id) */
  default_signature_id: number | null;
  /** SES でドメイン検証済み = 送信可 */
  sendable: boolean;
}

/**
 * スレッドへの返信フォーム(M2)。
 * - 返信先: 既定は直近の受信メールの差出人。1 件に書き換えられ、本文中のアドレスをボタンで入れられる(2026-10-29)
 * - 送信元: 既定はスレッドの受信箱。送信可能な受信箱をプルダウンで選べる
 * - 差出人表示名: 既定は送信元の設定値。その場で書き換え可
 * - 署名: 署名マスタ(有効なもの)から名前で選ぶ(既定は送信元の受信箱の既定署名)。「署名なし」も可
 * - 引用: 直近の受信メールを最初から入れる(編集可)
 * 送る本文は 本文 → 署名 → 引用 の順に合成し、画面のとおりに送る(サーバーは付け足さない)。
 * 送信ボタンではすぐに送らず「承認待ち」にする(migration 124)。送信日時を指定すると承認後その日時に送る。
 * 承認者(admin / manager)は「承認を依頼する / そのまま送信する」を選べる。送信ボタンの後に確認画面を出して確定する(2026-10-16)。
 */
export function MailReplyForm({
  threadId,
  replyTo,
  replyToCandidates = [],
  sendable,
  disabledReason,
  defaultBoxId,
  boxes,
  signatures,
  initialQuote,
  replySubject,
  canDirectSend = false,
}: {
  threadId: string;
  /** 返信先の既定値(直近の受信メールの差出人) */
  replyTo: string | null;
  /** 返信先の候補(直近の受信メールの本文にあるアドレス) */
  replyToCandidates?: string[];
  /** スレッドの受信箱から送れるか */
  sendable: boolean;
  disabledReason?: string;
  /** スレッドの受信箱(送信元の既定) */
  defaultBoxId: number;
  boxes: ReplyBoxOption[];
  /** 選べる署名(署名マスタの有効なもの) */
  signatures: SignatureOption[];
  /** 返信本文に最初から入れる引用 */
  initialQuote: string;
  /** 返信の件名の初期値(「Re: 元の件名」)。画面で書き換えられる(2026-10-28) */
  replySubject: string;
  /** 承認者(admin / manager)なら true。「そのまま送信する」を選べる */
  canDirectSend?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const defaultBox = boxes.find((b) => b.id === defaultBoxId);
  const anySendable = boxes.some((b) => b.sendable);
  const initialBox = defaultBox?.sendable ? defaultBox : boxes.find((b) => b.sendable);

  const [boxId, setBoxId] = useState<string>(initialBox ? String(initialBox.id) : '');
  const [fromName, setFromName] = useState(initialBox?.display_name ?? '');
  const [fromNameTouched, setFromNameTouched] = useState(false);
  // 署名は署名マスタの id で持つ('' = 署名なし)。初期値は送信元の受信箱の既定署名
  const [signatureId, setSignatureId] = useState<string>(
    defaultSignatureValue(initialBox?.default_signature_id, signatures),
  );
  const [signatureTouched, setSignatureTouched] = useState(false);
  const [text, setText] = useState('');
  const [quote, setQuote] = useState(initialQuote);
  const [subject, setSubject] = useState(replySubject);
  const [to, setTo] = useState(replyTo ?? '');
  const [cc, setCc] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [sendMode, setSendMode] = useState<MailSendMode>(
    // 承認者は「そのまま送信する」が既定(2026-10-21 ユーザー指定)
    canDirectSend ? 'direct' : 'approval',
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const att = useMailAttachments();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  if (!sendable && !anySendable) {
    return (
      <div className="rounded border border-dashed p-3 text-xs text-muted-foreground">
        この受信箱は<strong>受信専用</strong>です。{disabledReason ?? ''}
      </div>
    );
  }

  const signatureText = signatureBodyOf(signatureId, signatures);

  const handleBoxChange = (id: string) => {
    setBoxId(id);
    const box = boxes.find((b) => String(b.id) === id);
    if (!fromNameTouched) setFromName(box?.display_name ?? '');
    if (!signatureTouched)
      setSignatureId(defaultSignatureValue(box?.default_signature_id, signatures));
  };

  const outgoingBody = composeOutgoingBody({ text, signature: signatureText, quote });
  const selectedBox = boxes.find((b) => String(b.id) === boxId);

  const submit = () => {
    setError(null);
    setSent(null);
    startTransition(async () => {
      const body = outgoingBody;
      const r = await replyToMailThread({
        threadId,
        body,
        subject,
        to,
        cc,
        fromName,
        mailBoxId: Number(boxId),
        scheduledAt,
        sendMode,
        attachments: att.submitted,
      });
      if (r.error) {
        setError(r.error);
        // 保存はできて送信だけ失敗した場合は、送信待ちに残っているので入力は消して閉じる
        if (r.outboxId) {
          setConfirmOpen(false);
          router.refresh();
        }
        return;
      }
      setConfirmOpen(false);
      setText('');
      att.reset();
      setCc('');
      setSubject(replySubject);
      setTo(replyTo ?? '');
      setScheduledAt('');
      setSendMode(canDirectSend ? 'direct' : 'approval');
      setSent(r.message ?? '承認依頼を出しました');
      router.refresh();
    });
  };

  return (
    <>
      <form
        className="space-y-2 rounded border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          setSent(null);
          setConfirmOpen(true);
        }}
      >
        <div className="block text-xs">
          返信先(1 件)
          <Input
            aria-label="返信先"
            className="mt-1 font-mono"
            placeholder="例: customer@example.com"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            disabled={pending}
          />
          {/* フォーム通知は差出人がフォームの送信システムのため、本文にあるお客様のアドレスを選べるようにする */}
          {(replyToCandidates.length > 0 || (replyTo && to.trim() !== replyTo)) && (
            <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
              {replyToCandidates.length > 0 && <span>本文のアドレス:</span>}
              {replyToCandidates.map((a) => (
                <Button
                  key={a}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 font-mono text-[11px]"
                  disabled={pending || to.trim() === a}
                  onClick={() => setTo(a)}
                >
                  {a} を使う
                </Button>
              ))}
              {replyTo && to.trim() !== replyTo && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  disabled={pending}
                  onClick={() => setTo(replyTo)}
                >
                  差出人({replyTo})に戻す
                </Button>
              )}
            </div>
          )}
          {!sendable && defaultBox && (
            <p className="mt-1 text-amber-700">
              ※ {defaultBox.address} は受信専用のため、別の送信元を選んでいます
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="block flex-1 basis-56 text-xs">
            送信元
            <Select
              aria-label="送信元"
              className="mt-1"
              value={boxId}
              disabled={pending}
              onChange={(e) => handleBoxChange(e.target.value)}
            >
              {/* 受信箱が数百件あるため、ドメインごとのセクションに分けて探しやすくする */}
              {groupAddressesByDomain(boxes).map((g) => (
                <optgroup key={g.domain} label={g.domain || '(ドメインなし)'}>
                  {g.items.map((b) => (
                    <option key={b.id} value={String(b.id)} disabled={!b.sendable}>
                      {b.display_name ? `${b.display_name} <${b.address}>` : b.address}
                      {b.sendable ? '' : '(受信専用)'}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </div>
          <div className="block flex-1 basis-40 text-xs">
            差出人表示名(空欄でアドレスのみ表示)
            <Input
              aria-label="差出人表示名"
              className="mt-1"
              placeholder="例: ひらプロ"
              maxLength={80}
              value={fromName}
              onChange={(e) => {
                setFromName(e.target.value);
                setFromNameTouched(true);
              }}
              disabled={pending}
            />
          </div>
          <div className="block flex-1 basis-40 text-xs">
            CC(任意)
            <Input
              aria-label="CC"
              className="mt-1"
              placeholder="カンマ区切り"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              disabled={pending}
            />
          </div>
        </div>

        <div className="block text-xs">
          件名
          <Input
            aria-label="件名"
            className="mt-1"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={pending}
          />
        </div>

        <div className="block text-xs">
          本文
          <Textarea
            aria-label="本文"
            className="mt-1"
            placeholder="返信本文(画像をドラッグ&ドロップ・貼り付けすると、この位置に入ります)"
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={pending}
            {...bodyFileHandlers(att, text, setText)}
          />
        </div>

        <MailAttachmentField att={att} text={text} setText={setText} disabled={pending} />

        <div className="block text-xs">
          署名
          <Select
            aria-label="署名"
            className="mt-1 w-full max-w-md"
            value={signatureId}
            disabled={pending}
            onChange={(e) => {
              setSignatureId(e.target.value);
              setSignatureTouched(true);
            }}
          >
            <option value="">署名なし</option>
            {signatures.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
          </Select>
          {signatureText && (
            <pre className="mt-1 whitespace-pre-wrap rounded border bg-gray-50 p-2 font-sans text-[11px] text-muted-foreground">
              {signatureText}
            </pre>
          )}
          {signatures.length === 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              署名はメール設定の「署名」で登録すると選べるようになります。
            </p>
          )}
        </div>

        <div className="block text-xs">
          引用(このスレッドのやり取りを新しい順に入れています。不要な部分は消してください)
          <Textarea
            aria-label="引用"
            className="mt-1 text-muted-foreground"
            rows={6}
            value={quote}
            onChange={(e) => setQuote(e.target.value)}
            disabled={pending}
          />
        </div>

        {canDirectSend && (
          <SendModeField value={sendMode} onChange={setSendMode} disabled={pending} />
        )}
        <ScheduleField
          value={scheduledAt}
          onChange={setScheduledAt}
          disabled={pending}
          direct={sendMode === 'direct'}
        />

        <div className="flex items-center gap-2">
          <Button
            type="submit"
            size="sm"
            disabled={
              pending ||
              !text.trim() ||
              !to.trim() ||
              !boxId ||
              attachmentBlockReason(att.items) !== null
            }
          >
            {sendMode === 'direct' ? '送信内容を確認' : '承認依頼の内容を確認'}
          </Button>
          {attachmentBlockReason(att.items) && (
            <span className="text-xs text-muted-foreground">
              {attachmentBlockReason(att.items)}
            </span>
          )}
          {sent && <span className="text-xs text-emerald-700">{sent}</span>}
          {error && !confirmOpen && <span className="text-xs text-red-600">{error}</span>}
        </div>
      </form>
      <SendConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        pending={pending}
        error={error}
        onConfirm={submit}
        summary={{
          from: selectedBox
            ? `${fromName.trim() ? `${fromName.trim()} ` : ''}<${selectedBox.address}>`
            : '',
          to: to.trim(),
          cc,
          subject: subject.replace(/\s+/g, ' ').trim(),
          scheduledAt,
          mode: sendMode,
          body: outgoingBody,
          attachments: attachmentsToSend(att.items, outgoingBody),
        }}
      />
    </>
  );
}
