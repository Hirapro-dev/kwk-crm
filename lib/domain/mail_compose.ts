/**
 * メール送信の決定論的ロジック(CLAUDE.md §5.15 / §0.1 R6)。
 * Server Action(mail_send_actions.ts)から使う純粋関数。DB・外部 API には触れない。
 *
 * ここで決めていること:
 *   - 返信件名(Re: の付け方)
 *   - 顧客側でもスレッド化されるための In-Reply-To / References
 *   - 署名の付け方、引用の付け方
 *   - 宛先入力(カンマ・改行区切り)の解析と上限
 *   - 差出人表示名の MIME エンコード(SES は非 ASCII の表示名を encoded-word で要求する)
 */

import { formatDateTime } from '@/lib/utils/date';
import { extractReferencedMessageIds } from './mail_inbound';

/** 1通あたりの宛先(To + Cc)の上限。誤送信の被害を限定する */
export const MAX_RECIPIENTS = 20;

/** 返信件名。既に Re: があれば付けない */
export function buildReplySubject(subject: string | null | undefined): string {
  const s = (subject ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return 'Re: ';
  return /^re\s*[:：]/i.test(s) ? s : `Re: ${s}`;
}

/**
 * 返信時のスレッド用ヘッダ。
 * References は親の References に親の Message-ID を足したもの(RFC 5322 の慣例)。
 * これを付けると顧客側のメーラーでも同じスレッドにぶら下がる。
 */
export function buildReplyHeaders(parent: {
  message_id: string;
  references_header: string | null;
}): { inReplyTo: string; references: string } {
  const refs = extractReferencedMessageIds(null, parent.references_header);
  if (!refs.includes(parent.message_id)) refs.push(parent.message_id);
  return { inReplyTo: parent.message_id, references: refs.join(' ') };
}

/** 本文末尾に署名を付ける。署名が空なら本文のまま。区切りは "-- " (RFC 3676) */
export function appendSignature(body: string, signature: string | null | undefined): string {
  const sig = (signature ?? '').trim();
  const b = body.replace(/\s+$/, '');
  if (!sig) return `${b}\n`;
  return `${b}\n\n-- \n${sig}\n`;
}

/** 返信本文の下に付ける引用(テキスト)。"> " を各行の先頭に付ける */
export function buildQuotedBody(original: {
  from_address: string;
  from_name: string | null;
  sent_at: string | null;
  text_body: string | null;
}): string {
  const who = original.from_name
    ? `${original.from_name} <${original.from_address}>`
    : original.from_address;
  const when = formatDateTime(original.sent_at);
  const head = when ? `${when} ${who}:` : `${who}:`;
  const lines = (original.text_body ?? '').replace(/\r\n/g, '\n').split('\n');
  return [head, ...lines.map((l) => (l ? `> ${l}` : '>'))].join('\n');
}

const ADDRESS_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/**
 * 宛先入力(カンマ・セミコロン・改行区切り)を配列にする。
 * 形式が不正なものがあれば error で返す(黙って捨てない)。重複は除く。
 */
export function parseAddressList(input: string | null | undefined): {
  addresses: string[];
  error?: string;
} {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of (input ?? '').split(/[,;\n]/)) {
    const s = raw.trim();
    if (!s) continue;
    // "氏名 <addr>" 表記はアドレス部分だけ使う
    const m = s.match(/<([^<>]+)>\s*$/);
    const addr = (m ? m[1] : s)?.trim() ?? '';
    if (!ADDRESS_RE.test(addr)) {
      return { addresses: [], error: `宛先の形式が不正です: ${s}` };
    }
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(addr);
  }
  return { addresses: out };
}

/**
 * 差出人の表示名を SES に渡せる形にする。
 * ASCII のみなら引用符で囲み、非 ASCII(日本語)なら RFC 2047 の encoded-word にする
 * (SES の FromEmailAddress は非 ASCII を生で受け付けない)。
 */
export function formatFromAddress(address: string, displayName: string | null | undefined): string {
  const name = (displayName ?? '').trim();
  if (!name) return address;
  if (/^[\x20-\x7e]*$/.test(name)) {
    return `"${name.replace(/(["\\])/g, '\\$1')}" <${address}>`;
  }
  const encoded = Buffer.from(name, 'utf8').toString('base64');
  return `=?UTF-8?B?${encoded}?= <${address}>`;
}

/**
 * SES の SendEmail が返す MessageId から、送信メールに付く Message-ID ヘッダの
 * 期待値を作る。顧客の返信の In-Reply-To はこの値になる。
 * ドメイン部はリージョンで異なるため【要確認】。受信側は provider_message_id でも
 * 突合するので、ここが違っていてもスレッド化は成立する。
 */
export function sesMessageIdHeader(sesMessageId: string, region: string): string {
  return region === 'us-east-1'
    ? `<${sesMessageId}@email.amazonses.com>`
    : `<${sesMessageId}@${region}.amazonses.com>`;
}
