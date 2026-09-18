'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { groupAddressesByDomain } from '@/lib/domain/mail_folders';
import { replyToMailThread } from '@/lib/domain/mail_send_actions';
import {
  type SignatureOption,
  defaultSignatureValue,
  signatureBodyOf,
} from '@/lib/domain/mail_signatures';
import { composeOutgoingBody } from '@/lib/domain/mail_text';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

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
 * - 送信元: 既定はスレッドの受信箱。送信可能な受信箱をプルダウンで選べる
 * - 差出人表示名: 既定は送信元の設定値。その場で書き換え可
 * - 署名: 署名マスタ(有効なもの)から名前で選ぶ(既定は送信元の受信箱の既定署名)。「署名なし」も可
 * - 引用: 直近の受信メールを最初から入れる(編集可)
 * 送る本文は 本文 → 署名 → 引用 の順に合成し、画面のとおりに送る(サーバーは付け足さない)。
 */
export function MailReplyForm({
  threadId,
  replyTo,
  sendable,
  disabledReason,
  defaultBoxId,
  boxes,
  signatures,
  initialQuote,
}: {
  threadId: string;
  /** 返信先(表示用) */
  replyTo: string | null;
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
  const [cc, setCc] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

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

  const submit = () => {
    setError(null);
    setSent(false);
    startTransition(async () => {
      const body = composeOutgoingBody({ text, signature: signatureText, quote });
      const r = await replyToMailThread({
        threadId,
        body,
        cc,
        fromName,
        mailBoxId: Number(boxId),
      });
      if (r.error) {
        setError(r.error);
        return;
      }
      setText('');
      setCc('');
      setSent(true);
      router.refresh();
    });
  };

  return (
    <form
      className="space-y-2 rounded border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="text-xs text-muted-foreground">
        返信先: <span className="font-mono">{replyTo ?? '(不明)'}</span>
        {!sendable && defaultBox && (
          <span className="ml-2 text-amber-700">
            ※ {defaultBox.address} は受信専用のため、別の送信元を選んでいます
          </span>
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
        本文
        <Textarea
          aria-label="本文"
          className="mt-1"
          placeholder="返信本文"
          rows={8}
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
        {signatures.length === 0 && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            署名はメール設定の「署名」で登録すると選べるようになります。
          </p>
        )}
      </div>

      <div className="block text-xs">
        引用(返信対象のメール。不要なら消してください)
        <Textarea
          aria-label="引用"
          className="mt-1 text-muted-foreground"
          rows={6}
          value={quote}
          onChange={(e) => setQuote(e.target.value)}
          disabled={pending}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending || !text.trim() || !boxId}>
          {pending ? '送信中…' : '返信を送信'}
        </Button>
        {sent && <span className="text-xs text-emerald-700">送信しました</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </form>
  );
}
