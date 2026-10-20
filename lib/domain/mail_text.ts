/**
 * メール本文の組み立て(CLAUDE.md §5.15 / §0.1 R6)。
 * 返信フォーム(クライアント)と Server Action の両方から使う純粋関数。
 * サーバー専用モジュール(node:crypto 等)に依存させない。
 *
 *   - 署名の付け方("-- " 区切り、RFC 3676)
 *   - 返信時の引用(日時・差出人の行 + 各行 "> ")
 *   - HTML しか無いメールを引用するためのテキスト化
 *   - 本文 + 署名 + 引用 の合成(送るものをそのまま画面に出す)
 */

import { formatDateTime } from '@/lib/utils/date';

/** 本文末尾に署名を付ける。署名が空なら本文のまま。区切りは "-- " (RFC 3676) */
export function appendSignature(body: string, signature: string | null | undefined): string {
  const sig = (signature ?? '').trim();
  const b = body.replace(/\s+$/, '');
  if (!sig) return `${b}\n`;
  return `${b}\n\n-- \n${sig}\n`;
}

/**
 * HTML 本文を引用用のテキストにする(HTML しか無いメール向けの簡易変換)。
 * style/script を捨て、ブロック要素と br を改行にし、タグを外して主要な実体参照を戻す。
 * 表示の再現ではなく「何が書いてあったか」を引用するのが目的。
 */
export function htmlToPlainText(html: string): string {
  let s = html.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table|section|article)>/gi, '\n');
  s = s.replace(/<\/?[^>]+>/g, '');
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  return s
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 引用の元にするテキスト。テキスト版があればそれ、無ければ HTML をテキスト化 */
export function quoteSourceText(m: {
  text_body: string | null;
  html_body?: string | null;
}): string {
  const t = (m.text_body ?? '').trim();
  if (t) return t;
  return m.html_body ? htmlToPlainText(m.html_body) : '';
}

/** 返信本文の下に付ける引用(テキスト)。"> " を各行の先頭に付ける */
export function buildQuotedBody(original: {
  from_address: string;
  from_name: string | null;
  sent_at: string | null;
  text_body: string | null;
  html_body?: string | null;
}): string {
  const who = original.from_name
    ? `${original.from_name} <${original.from_address}>`
    : original.from_address;
  const when = formatDateTime(original.sent_at);
  const head = when ? `${when} ${who}:` : `${who}:`;
  const lines = quoteSourceText(original).replace(/\r\n/g, '\n').split('\n');
  return [head, ...lines.map((l) => (l ? `> ${l}` : '>'))].join('\n');
}

/**
 * 本文から、既に入っている引用を外す(スレッドのやり取りを全部引用するとき、同じ文章を何重にも入れないため)。
 * - "> "(全角の"＞"も)で始まる行
 * - その引用の直前にある「…:」「…：」で終わる見出し行(「2026年10月6日 … <x@y>:」など)
 * 末尾の空行は詰める。
 */
export function stripQuotedLines(body: string): string {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const isQuote = (l: string | undefined) => l !== undefined && /^\s*[>＞]/.test(l);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] ?? '';
    if (isQuote(l)) continue;
    if (/[:：]\s*$/.test(l) && isQuote(lines[i + 1])) continue;
    out.push(l);
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+$/, '');
}

/** スレッド全体の引用の上限(文字)。送信の本文上限 50,000 文字に、本文・署名の分を残す */
export const THREAD_QUOTE_MAX_CHARS = 30_000;

/**
 * 返信フォームに最初から入れる引用(スレッドのやり取り全部。2026-10-20 ユーザー要望)。
 * 新しいメールから順に、各メールの「日時 差出人:」の行 + 本文("> " 付き)を空行区切りで並べる。
 * 各メールに入っている引用は外し(stripQuotedLines)、上限を超えたら古い方を省略してその旨を書く。
 * messages はどの順で渡してもよい(送受信日時で並べ直す)。
 */
export function buildThreadQuote(
  messages: ReadonlyArray<{
    from_address: string;
    from_name: string | null;
    sent_at: string | null;
    text_body: string | null;
    html_body?: string | null;
  }>,
  maxChars = THREAD_QUOTE_MAX_CHARS,
): string {
  const sorted = [...messages].sort(
    (a, b) => Date.parse(b.sent_at ?? '') - Date.parse(a.sent_at ?? '') || 0,
  );
  const blocks: string[] = [];
  let total = 0;
  for (const m of sorted) {
    const block = buildQuotedBody({
      ...m,
      text_body: stripQuotedLines(quoteSourceText(m)),
      html_body: null,
    });
    if (blocks.length > 0 && total + block.length > maxChars) {
      blocks.push('> (これより前のやり取りは省略しました)');
      break;
    }
    blocks.push(block);
    total += block.length + 2;
  }
  return blocks.join('\n\n');
}

/**
 * 送信する本文を合成する: 本文 → 署名("-- " 区切り) → 引用。
 * フォームはこの結果をそのまま送るので、画面で見えるものと送られるものが一致する。
 */
export function composeOutgoingBody(parts: {
  text: string;
  signature?: string | null;
  quote?: string | null;
}): string {
  const text = (parts.text ?? '').replace(/\s+$/, '');
  const sig = (parts.signature ?? '').trim();
  const quote = (parts.quote ?? '').replace(/\s+$/, '');
  let out = text;
  if (sig) out = `${out}\n\n-- \n${sig}`;
  if (quote) out = `${out}\n\n${quote}`;
  return `${out.replace(/^\n+/, '')}\n`;
}
