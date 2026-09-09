'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { createMailThreadAndSend } from '@/lib/domain/mail_send_actions';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

export interface ComposeBoxOption {
  id: number;
  address: string;
  display_name: string | null;
  /** SES でドメイン検証済み = 送信可 */
  sendable: boolean;
}

/** 新規メール作成フォーム(M2)。送信後は作成されたスレッドへ遷移する */
export function MailComposeForm({
  boxes,
  initialTo,
}: {
  boxes: ComposeBoxOption[];
  initialTo?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const firstSendable = boxes.find((b) => b.sendable);
  const [boxId, setBoxId] = useState<string>(firstSendable ? String(firstSendable.id) : '');
  const [to, setTo] = useState(initialTo ?? '');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [fromName, setFromName] = useState(firstSendable?.display_name ?? '');
  // 差出人表示名を手で書き換えたら、以降は差出人(受信箱)を変えても上書きしない
  const [fromNameTouched, setFromNameTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleBoxChange = (id: string) => {
    setBoxId(id);
    if (!fromNameTouched) {
      const box = boxes.find((b) => String(b.id) === id);
      setFromName(box?.display_name ?? '');
    }
  };

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const r = await createMailThreadAndSend({
        mailBoxId: Number(boxId),
        to,
        cc,
        subject,
        body,
        fromName,
      });
      if (r.error) {
        setError(r.error);
        return;
      }
      if (r.threadId) router.push(`/mail/${r.threadId}`);
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
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
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
          {boxes.map((b) => (
            <option key={b.id} value={String(b.id)} disabled={!b.sendable}>
              {b.display_name ? `${b.display_name} <${b.address}>` : b.address}
              {b.sendable ? '' : '(受信専用)'}
            </option>
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
        本文(署名は自動で末尾に付きます)
        <Textarea
          aria-label="本文"
          className="mt-1"
          rows={12}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={pending}
        />
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={pending || !to.trim() || !subject.trim() || !body.trim()}
        >
          {pending ? '送信中…' : '送信'}
        </Button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </form>
  );
}
