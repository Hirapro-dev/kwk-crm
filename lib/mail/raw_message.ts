/**
 * 添付付きメールの本体(MIME)を組み立てる(CLAUDE.md §5.15「送信メールの添付」)。サーバー専用。
 * 添付があるときだけ SES の Raw 送信で使う(添付なしは従来どおり Simple 送信)。
 *
 * 組み立ては nodemailer の MailComposer に任せる(日本語の件名・差出人名・ファイル名の符号化、
 * multipart/mixed・related・alternative の入れ子を自前で書かないため)。
 * 添付は必ず中身(Buffer)で渡し、path / href(ファイルや URL の読み込み)は使わない。
 */

import MailComposer from 'nodemailer/lib/mail-composer';

export interface RawAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
  /** 本文中の画像の cid。null は通常の添付 */
  cid: string | null;
}

export interface RawMessageInput {
  fromAddress: string;
  fromName?: string | null;
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  /** HTML 本文(本文中の画像・返信の HTML 引用があるとき)。無ければテキストだけ */
  html?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  attachments: RawAttachment[];
}

export async function buildRawMessage(input: RawMessageInput): Promise<Buffer> {
  const name = (input.fromName ?? '').trim();
  const from = name ? { name, address: input.fromAddress } : input.fromAddress;
  const composer = new MailComposer({
    from,
    replyTo: input.fromAddress,
    to: input.to,
    ...(input.cc && input.cc.length > 0 ? { cc: input.cc } : {}),
    subject: input.subject,
    text: input.text,
    ...(input.html ? { html: input.html } : {}),
    ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
    ...(input.references ? { references: input.references } : {}),
    attachments: input.attachments.map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      content: a.content,
      ...(a.cid ? { cid: a.cid, contentDisposition: 'inline' } : {}),
    })),
  });
  return composer.compile().build();
}
