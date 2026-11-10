'use client';

/**
 * 送信メールのカードの「コピーして編集」(CLAUDE.md §5.15「送信済みメールのコピー」)。
 * 押すと画面内のイベントで返信フォーム(MailReplyForm)に知らせ、フォーム側がそのメールの中身を読み込んで入れる。
 * (カードはサーバー側で描くスレッド画面の一部で、返信フォームとは離れた場所にあるため、イベントでつなぐ)
 */

import { Button } from '@/components/ui/button';
import { MAIL_COPY_SENT_EVENT } from '@/lib/domain/mail_copy';
import { Copy } from 'lucide-react';

export function CopySentMailButton({ messageId }: { messageId: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-6 gap-1 px-2 text-[11px]"
      onClick={() =>
        window.dispatchEvent(new CustomEvent(MAIL_COPY_SENT_EVENT, { detail: { messageId } }))
      }
    >
      <Copy className="h-3 w-3" aria-hidden="true" />
      コピーして編集
    </Button>
  );
}
