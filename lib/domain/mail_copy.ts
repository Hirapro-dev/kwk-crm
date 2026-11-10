/**
 * 送信済みメールの「コピーして編集」(CLAUDE.md §5.15「送信済みメールのコピー」)の純粋関数。
 * 送ったメールの中身を返信フォームに入れるための値を決める。DB・Storage には触らない
 * (Server Action `prepareSentMailCopy` と返信フォームの両方から使う)。
 *
 *   - コピーする本文(送信待ちの本文 → 保存した本文 の順。中の引用は外す)
 *   - 末尾の署名を外して、その署名を選ぶ
 *   - コピーする添付(送れる種類・上限・本文中の画像の扱い)
 *   - 送信元の受信箱
 */

import {
  type MailAttachmentType,
  checkNewAttachments,
  inlineMarker,
  uniqueFilename,
} from '@/lib/domain/mail_outgoing_attachments';
import type { SignatureOption } from '@/lib/domain/mail_signatures';
import { quoteSourceText, stripQuotedLines } from '@/lib/domain/mail_text';

/** 「コピーして編集」ボタンから返信フォームへ伝える画面内のイベント名(detail: { messageId }) */
export const MAIL_COPY_SENT_EVENT = 'crm:mail-copy-sent';

/**
 * コピーする本文。送信待ちの記録があればその本文(本文 + 署名)、無ければ保存した本文
 * (テキスト版、無ければ HTML をテキスト化)。どちらも中の引用(> の行とその見出し行)は外す
 * (2026-10-30 より前の送信待ちと、メールディーラーの取込分は本文に引用を含むため)。
 */
export function sentMailCopyText(src: {
  outboxText: string | null | undefined;
  textBody: string | null | undefined;
  htmlBody: string | null | undefined;
}): string {
  const base =
    src.outboxText != null && src.outboxText.trim() !== ''
      ? src.outboxText
      : quoteSourceText({ text_body: src.textBody ?? null, html_body: src.htmlBody ?? null });
  return stripQuotedLines(base).replace(/^\n+/, '');
}

/**
 * 本文の末尾が有効な署名と一致したら、本文から外してその署名を選ぶ(返信フォームが署名を付け足すので、二重にしない)。
 * - 署名は行の頭から一致したときだけ(行の途中で末尾が同じだけのものは外さない)
 * - 複数に一致するときは長い署名を優先(短い方だと署名の一部が本文に残る)
 * - 署名の直前の「-- 」の区切り行(2026-10-21 より前の形式)も外す
 * 一致しなければ全文を本文に入れ、署名は「署名なし」('')。
 */
export function splitSignature(
  body: string,
  signatures: readonly SignatureOption[],
): { text: string; signatureId: string } {
  const b = (body ?? '').replace(/\r\n/g, '\n').replace(/\s+$/, '');
  const candidates = signatures
    .filter((s) => s.is_active)
    .map((s) => ({ id: s.id, body: (s.body ?? '').replace(/\r\n/g, '\n').trim() }))
    .filter((s) => s.body !== '')
    .sort((x, y) => y.body.length - x.body.length);
  for (const s of candidates) {
    if (!b.endsWith(s.body)) continue;
    const rest = b.slice(0, b.length - s.body.length);
    // 行の頭から一致しているか(署名の前が本文の先頭か改行)
    if (rest !== '' && !rest.endsWith('\n')) continue;
    const text = rest
      .replace(/\s+$/, '')
      .replace(/(^|\n)--$/, '')
      .replace(/\s+$/, '');
    return { text, signatureId: String(s.id) };
  }
  return { text: b, signatureId: '' };
}

/** コピー元の添付(送信待ちの添付、または mail_attachments) */
export interface CopySourceAttachment {
  filename: string;
  content_type: string | null;
  size_bytes: number;
  storage_path: string;
  /** 本文中の画像の cid(送信待ちの添付のみ)。NULL = 通常の添付 */
  content_id: string | null;
}

export interface PlannedCopyAttachment {
  /** 複製元の Storage のキー */
  storagePath: string;
  /** 返信フォームに出す名前(同名はずらす) */
  filename: string;
  contentType: MailAttachmentType;
  size: number;
  /** 本文中の画像として戻すか */
  inline: boolean;
}

/**
 * コピーする添付を決める。本文中の画像は、本文に目印が残っているもの(= 実際に送ったもの)だけを本文中の画像として戻す。
 * 種類・件数・合計の上限は通常の添付と同じ(checkNewAttachments)。外れたものは付けずに理由を返す。
 * 本文中の画像の名前は本文の目印と同じでなければならないので、先に名前を確保してから通常の添付の名前をずらす。
 */
export function planCopyAttachments(
  items: readonly CopySourceAttachment[],
  text: string,
): { accepted: PlannedCopyAttachment[]; skipped: string[] } {
  const usable = items.filter((it) => !it.content_id || text.includes(inlineMarker(it.filename)));
  const check = checkNewAttachments(
    [],
    usable.map((it) => ({
      name: it.filename,
      size: it.size_bytes,
      type: it.content_type ?? '',
      source: it,
    })),
  );
  const names: string[] = check.accepted.filter((a) => a.source.content_id).map((a) => a.name);
  const accepted = check.accepted.map((a) => {
    const inline = !!a.source.content_id;
    let filename = a.name;
    if (!inline) {
      filename = uniqueFilename(a.name, names);
      names.push(filename);
    }
    return {
      storagePath: a.source.storage_path,
      filename,
      contentType: a.contentType,
      size: a.size,
      inline,
    };
  });
  return { accepted, skipped: check.errors };
}

/**
 * コピー時の送信元の受信箱。送信待ちの記録の受信箱があればそれ、無ければ差出人アドレスの受信箱(大文字小文字は区別しない)。
 * どれにも当たらなければ null(返信フォームは今の送信元のまま)。送れるかどうかは返信フォームが確かめる。
 */
export function resolveCopyBoxId(
  outboxBoxId: number | null | undefined,
  fromAddress: string | null | undefined,
  boxes: ReadonlyArray<{ id: number; address: string }>,
): number | null {
  if (outboxBoxId != null) return outboxBoxId;
  const from = (fromAddress ?? '').trim().toLowerCase();
  if (!from) return null;
  return boxes.find((b) => b.address.toLowerCase() === from)?.id ?? null;
}
