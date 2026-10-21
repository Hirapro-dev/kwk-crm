'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { type MailSendMode, scheduleInputLabel } from '@/lib/domain/mail_outbox';
import { formatAttachmentSize } from './MailAttachments';

export interface SendConfirmSummary {
  /** 送信元(表示名 <アドレス>) */
  from: string;
  to: string;
  cc: string;
  subject: string;
  /** 送信予約(datetime-local の値。空なら予約なし) */
  scheduledAt: string;
  mode: MailSendMode;
  /** 実際に送る本文(署名・引用を含めた完成形) */
  body: string;
  /** 送る添付(本文中の画像は目印が本文に残っているものだけ) */
  attachments?: Array<{ filename: string; size: number; inline: boolean }>;
}

/**
 * 送信待ちメールの承認・そのまま送信・送り直しで使うときの文言の上書き(2026-10-16)。
 * 指定した項目だけ既定の文言(返信・新規作成の送信用)を置き換える。
 */
export interface SendConfirmTexts {
  title?: string;
  lead?: string;
  methodLabel?: string;
  whenLabel?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

/**
 * 送信前の確認画面(2026-10-16。ユーザー決定)。返信・新規作成の送信ボタンの後に、送る内容をそのまま見せて確定させる。
 * 本文は画面で組み立てたものをそのまま出す(サーバーで付け足すものは無い。§5.15)。
 */
export function SendConfirmDialog({
  open,
  onOpenChange,
  summary,
  pending,
  error,
  onConfirm,
  texts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: SendConfirmSummary;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  texts?: SendConfirmTexts;
}) {
  const scheduled = scheduleInputLabel(summary.scheduledAt);
  const direct = summary.mode === 'direct';
  const when = direct
    ? scheduled
      ? `${scheduled} に送信(予約)`
      : 'すぐに送信'
    : scheduled
      ? `承認後、${scheduled} に送信`
      : '承認されたらすぐに送信';
  const rows: Array<[string, string]> = [
    [
      '送信方法',
      texts?.methodLabel ??
        (direct ? '承認せずにそのまま送信' : '承認を依頼する(承認待ちになります)'),
    ],
    ['送信日時', texts?.whenLabel ?? when],
    ['送信元', summary.from],
    ['宛先', summary.to],
    ...(summary.cc.trim() ? ([['CC', summary.cc]] as Array<[string, string]>) : []),
    ['件名', summary.subject || '(件名なし)'],
  ];
  const confirmLabel =
    texts?.confirmLabel ??
    (direct ? (scheduled ? '予約して送信する' : '送信する') : '承認を依頼する');

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent
        className="max-w-[95%] sm:max-w-[720px]"
        onClose={() => !pending && onOpenChange(false)}
      >
        <DialogHeader>
          <DialogTitle>{texts?.title ?? '送信内容の確認'}</DialogTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {texts?.lead ??
              `この内容で${direct ? '送信' : '承認を依頼'}します。直す場合は「戻って修正」を押してください。`}
          </p>
        </DialogHeader>
        <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1 text-xs">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0 break-all">{v}</dd>
            </div>
          ))}
        </dl>
        <pre className="mt-3 max-h-[45vh] overflow-auto whitespace-pre-wrap rounded border bg-gray-50 p-3 font-sans text-sm">
          {summary.body}
        </pre>
        {summary.attachments && summary.attachments.length > 0 && (
          <div className="mt-2 text-xs">
            <div className="text-muted-foreground">添付({summary.attachments.length} 件)</div>
            <ul className="mt-1 flex flex-wrap gap-1">
              {summary.attachments.map((a) => (
                <li key={a.filename} className="rounded border px-2 py-0.5">
                  📎 {a.filename}{' '}
                  <span className="text-muted-foreground">{formatAttachmentSize(a.size)}</span>
                  {a.inline && <span className="ml-1 text-sky-700">(本文中の画像)</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {texts?.cancelLabel ?? '戻って修正'}
          </Button>
          <Button size="sm" disabled={pending} onClick={onConfirm}>
            {pending ? '処理中…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
