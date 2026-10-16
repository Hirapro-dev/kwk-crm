'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { groupAddressesByDomain } from '@/lib/domain/mail_folders';
import type { MailSendMode } from '@/lib/domain/mail_outbox';
import { createMailThreadAndSend } from '@/lib/domain/mail_send_actions';
import {
  type SignatureOption,
  defaultSignatureValue,
  signatureBodyOf,
} from '@/lib/domain/mail_signatures';
import { composeOutgoingBody } from '@/lib/domain/mail_text';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ScheduleField, SendModeField } from '../ScheduleField';
import { SendConfirmDialog } from '../SendConfirmDialog';

export interface ComposeBoxOption {
  id: number;
  address: string;
  display_name: string | null;
  /** 既定の署名(mail_signatures.id) */
  default_signature_id: number | null;
  /** SES でドメイン検証済み = 送信可 */
  sendable: boolean;
}

/**
 * 新規メール作成フォーム(M2)。送信ボタンではすぐに送らず「承認待ち」にし(migration 124)、
 * 作成した送信待ちメールの画面へ遷移する。送信日時を指定すると承認後その日時に送る。
 * 承認者(admin / manager)は「そのまま送信する」も選べ(送れたら作成されたスレッドへ移動)、送信ボタンの後に確認画面を出す(2026-10-16)。
 * 署名は返信フォームと同じく署名マスタからプルダウンで選び(既定は送信元の受信箱の既定署名)、本文の下に見える形で付けて送る。
 */
export function MailComposeForm({
  boxes,
  signatures,
  initialTo,
  canDirectSend = false,
}: {
  boxes: ComposeBoxOption[];
  /** 選べる署名(署名マスタの有効なもの) */
  signatures: SignatureOption[];
  initialTo?: string;
  /** 承認者(admin / manager)なら true。「そのまま送信する」を選べる */
  canDirectSend?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const firstSendable = boxes.find((b) => b.sendable);
  const [boxId, setBoxId] = useState<string>(firstSendable ? String(firstSendable.id) : '');
  const [to, setTo] = useState(initialTo ?? '');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [fromName, setFromName] = useState(firstSendable?.display_name ?? '');
  // 差出人表示名・署名を手で変えたら、以降は差出人(受信箱)を変えても上書きしない
  const [fromNameTouched, setFromNameTouched] = useState(false);
  const [signatureId, setSignatureId] = useState<string>(
    defaultSignatureValue(firstSendable?.default_signature_id, signatures),
  );
  const [signatureTouched, setSignatureTouched] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [sendMode, setSendMode] = useState<MailSendMode>('approval');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signatureText = signatureBodyOf(signatureId, signatures);

  const handleBoxChange = (id: string) => {
    setBoxId(id);
    const box = boxes.find((b) => String(b.id) === id);
    if (!fromNameTouched) setFromName(box?.display_name ?? '');
    if (!signatureTouched)
      setSignatureId(defaultSignatureValue(box?.default_signature_id, signatures));
  };

  const outgoingBody = composeOutgoingBody({ text, signature: signatureText });
  const selectedBox = boxes.find((b) => String(b.id) === boxId);

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const r = await createMailThreadAndSend({
        mailBoxId: Number(boxId),
        to,
        cc,
        subject,
        body: outgoingBody,
        fromName,
        scheduledAt,
        sendMode,
      });
      if (r.error) {
        setError(r.error);
        // 保存はできて送信だけ失敗した場合は、送信待ちの画面で状態を確認できる
        if (r.outboxId) router.push(`/mail/outbox/${r.outboxId}`);
        return;
      }
      // そのまま送信して送れたら作られたスレッドへ、それ以外(承認依頼・予約)は送信待ちの画面へ
      if (r.threadId) router.push(`/mail/${r.threadId}`);
      else if (r.outboxId) router.push(`/mail/outbox/${r.outboxId}`);
    });
  };

  if (!firstSendable) {
    return (
      <div className="rounded border border-dashed p-4 text-sm text-muted-foreground">
        送信できる受信箱がありません。SES
        で送信元ドメインを検証すると、その受信箱から送信できるようになります。
      </div>
    );
  }

  return (
    <>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          setConfirmOpen(true);
        }}
      >
        <div className="block text-xs">
          差出人
          <Select
            aria-label="差出人"
            className="mt-1 w-full max-w-md"
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
        <div className="block text-xs">
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
        <div className="block text-xs">
          宛先(カンマ区切り)
          <Input
            aria-label="宛先"
            className="mt-1"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            disabled={pending}
            placeholder="customer@example.com"
          />
        </div>
        <div className="block text-xs">
          CC(任意)
          <Input
            aria-label="CC"
            className="mt-1"
            value={cc}
            onChange={(e) => setCc(e.target.value)}
            disabled={pending}
          />
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
            rows={12}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={pending}
          />
        </div>
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
              {`-- \n${signatureText}`}
            </pre>
          )}
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
            disabled={pending || !to.trim() || !subject.trim() || !text.trim()}
          >
            {sendMode === 'direct' ? '送信内容を確認' : '承認依頼の内容を確認'}
          </Button>
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
          to,
          cc,
          subject,
          scheduledAt,
          mode: sendMode,
          body: outgoingBody,
        }}
      />
    </>
  );
}
