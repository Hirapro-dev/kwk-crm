/**
 * 返信の HTML 版の引用(CLAUDE.md §5.15「返信の引用(HTML)」。2026-10-30 ユーザー決定)。純粋関数のみ。
 *
 * テキスト版の引用(mail_text.ts の buildThreadQuote)と同じく、スレッドのやり取りを新しい順に並べ、
 * 各メールを「日時 差出人:」の行 + 左に線の入った <blockquote> で入れる。HTML 本文のあるメールは HTML のまま、
 * テキストしか無いメールはテキストを HTML にして入れる。
 *
 * - 無害化: 外部から届いた HTML をこちらの送信メールに入れるため、スクリプト・フォーム・埋め込み・<style>・
 *   イベント属性(on…)・javascript: などの URL を取り除く(相手のメールソフトで動くものを送らない)
 * - 既存の引用の除去: 各メールの中に既に入っている引用(<blockquote>、Gmail の gmail_quote、Outlook の divRplyFwdMsg 以降、
 *   この CRM が付けた crm_quote)を外し、同じ文章を何重にも入れない。外しきれないものは残る(推測頼みのため)
 * - 本文に埋め込まれた画像(cid: / data: など http(s) 以外)は相手側で表示できないので、画像の代わりに代替テキストを置く
 *   (2026-10-30 ユーザー決定。data: はメルマガで数 MB になることがあり、Gmail も表示しない)
 * - 大きさの上限を超えたら古い方を省略してその旨を書く
 */

import type { ChildNode, Element } from 'domhandler';
import { DomUtils, parseDocument } from 'htmlparser2';
import { escapeHtml, textToHtml } from './mail_outgoing_attachments';
import { quoteHeadLine, quoteSourceText, stripQuotedLines } from './mail_text';

/** HTML 版の引用全体の上限(文字)。大きなメルマガ等の HTML を何通も重ねて送らないため */
export const THREAD_QUOTE_HTML_MAX_CHARS = 500_000;

/** この CRM が付ける引用の外枠の class(次の返信で既存の引用として外すための目印) */
export const CRM_QUOTE_CLASS = 'crm_quote';

/** 中身ごと取り除く要素 */
const DROP_TAGS = new Set([
  'script',
  'style',
  'head',
  'title',
  'meta',
  'link',
  'base',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'svg',
  'math',
  'noscript',
  'template',
  'audio',
  'video',
  'source',
  'track',
  'canvas',
  'portal',
  'dialog',
]);

/** 既存の引用として中身ごと外す要素か */
function isQuoteElement(el: Element): boolean {
  if (el.name === 'blockquote') return true;
  const cls = ` ${(el.attribs.class ?? '').toLowerCase()} `;
  return (
    cls.includes(' gmail_quote ') ||
    cls.includes(' gmail_extra ') ||
    cls.includes(' yahoo_quoted ') ||
    cls.includes(` ${CRM_QUOTE_CLASS} `)
  );
}

/** Outlook の返信見出し(ここから後ろは前のやり取り) */
function isOutlookReplyHeader(el: Element): boolean {
  const id = (el.attribs.id ?? '').toLowerCase();
  return id === 'divrplyfwdmsg' || id === 'appendonsend';
}

const URL_ATTRS = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'background',
  'poster',
  'xlink:href',
]);

/** URL として許す形(http(s) / mailto / tel / ページ内リンク)。それ以外(javascript: 等)は属性ごと外す */
function isSafeUrl(name: string, value: string): boolean {
  // 空白・制御文字を挟んだ「java script:」のような書き方も見抜けるよう、それらを除いてから判定する
  const v = Array.from(value)
    .filter((c) => c.charCodeAt(0) > 0x20)
    .join('')
    .toLowerCase();
  if (v.startsWith('#')) return name === 'href';
  if (/^https?:/.test(v)) return name === 'href' || name === 'src' || name === 'background';
  if (/^(mailto|tel):/.test(v)) return name === 'href';
  return false;
}

/** style 属性で外すもの(古い IE の expression、URL 経由のスクリプト、画面に貼り付く配置) */
function isUnsafeStyle(value: string): boolean {
  return /expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding|@import|position\s*:\s*(fixed|sticky)/i.test(
    value,
  );
}

function cleanAttributes(el: Element): void {
  for (const name of Object.keys(el.attribs)) {
    const lower = name.toLowerCase();
    const value = el.attribs[name] ?? '';
    if (
      lower.startsWith('on') ||
      lower === 'srcdoc' ||
      lower === 'srcset' ||
      lower === 'formaction'
    ) {
      delete el.attribs[name];
    } else if (URL_ATTRS.has(lower) && !isSafeUrl(lower, value)) {
      delete el.attribs[name];
    } else if (lower === 'style' && isUnsafeStyle(value)) {
      delete el.attribs[name];
    } else if (lower === 'target') {
      delete el.attribs[name];
    }
  }
}

/**
 * http(s) 以外の画像(cid: / data: など本文に埋め込まれた画像、src なし)を代替テキストに置き換える。http(s) の画像は残す。
 * 空の <img> を残すと、相手のメールソフトで壊れた画像の印が出るため。
 */
function replaceEmbeddedImage(el: Element): boolean {
  if (el.name !== 'img') return false;
  if (isSafeUrl('src', el.attribs.src ?? '')) return false;
  const alt = (el.attribs.alt ?? '').trim();
  const text = parseDocument(escapeHtml(alt ? `[画像: ${alt}]` : '[画像]')).children;
  DomUtils.replaceElement(el, text[0] as ChildNode);
  return true;
}

/** 子要素を順に処理する(削除・置換で配列が変わるので写してから回す) */
function walk(nodes: ChildNode[]): void {
  for (const node of [...nodes]) {
    if (node.type === 'comment' || node.type === 'directive' || node.type === 'cdata') {
      DomUtils.removeElement(node);
      continue;
    }
    if (node.type !== 'tag' && node.type !== 'script' && node.type !== 'style') continue;
    const el = node as Element;
    const name = el.name.toLowerCase();
    if (DROP_TAGS.has(name) || isQuoteElement(el)) {
      DomUtils.removeElement(el);
      continue;
    }
    if (isOutlookReplyHeader(el)) {
      // 見出しとそれより後ろの兄弟(前のやり取り)を外す。直前の区切り線も外す
      const prev = DomUtils.prevElementSibling(el);
      let cur: ChildNode | null = el;
      while (cur) {
        const next: ChildNode | null = cur.next;
        DomUtils.removeElement(cur);
        cur = next;
      }
      if (prev && prev.name === 'hr') DomUtils.removeElement(prev);
      continue;
    }
    if (replaceEmbeddedImage(el)) continue;
    cleanAttributes(el);
    walk(el.children);
  }
}

/** <html> / <body> の外枠を外して中身だけにする */
function bodyChildren(nodes: ChildNode[]): ChildNode[] {
  const body = DomUtils.findOne((e) => e.name.toLowerCase() === 'body', nodes, true);
  if (body) return body.children;
  const html = DomUtils.findOne((e) => e.name.toLowerCase() === 'html', nodes, false);
  return html ? html.children : nodes;
}

/**
 * 受信メールの HTML を、返信の引用に入れられる形にする(無害化 + 既存の引用の除去)。
 * 戻り値は <body> の中身にあたる HTML 断片。文字も画像も残らなければ空文字。
 */
export function sanitizeQuotedHtml(html: string): string {
  const doc = parseDocument(html, { lowerCaseTags: true, lowerCaseAttributeNames: true });
  walk(doc.children);
  const nodes = bodyChildren(doc.children);
  const hasText = DomUtils.textContent(nodes).replace(/[\s 　]/g, '') !== '';
  const hasImage = DomUtils.findOne((e) => e.name === 'img', nodes, true) !== null;
  if (!hasText && !hasImage) return '';
  return DomUtils.getOuterHTML(nodes, { encodeEntities: 'utf8' }).trim();
}

interface QuoteMessage {
  from_address: string;
  from_name: string | null;
  sent_at: string | null;
  text_body: string | null;
  html_body?: string | null;
}

/** 1 通分の引用の中身(HTML 本文があれば無害化した HTML、無ければテキストを HTML に) */
function messageQuoteContent(m: QuoteMessage): string {
  if (m.html_body?.trim()) {
    const cleaned = sanitizeQuotedHtml(m.html_body);
    if (cleaned) return cleaned;
  }
  return textToHtml(
    stripQuotedLines(quoteSourceText({ text_body: m.text_body, html_body: m.html_body })),
  );
}

const HEAD_STYLE = 'margin:0 0 4px;color:#555;';
const BLOCKQUOTE_STYLE = 'margin:0 0 16px 0.8ex;border-left:1px solid #ccc;padding-left:1ex;';

/**
 * 返信に付ける HTML 版の引用(スレッドのやり取り全部、新しい順)。messages はどの順で渡してもよい。
 * メールが無ければ空文字。外枠に CRM_QUOTE_CLASS を付ける(次の返信で外すため)。
 */
export function buildThreadQuoteHtml(
  messages: ReadonlyArray<QuoteMessage>,
  maxChars = THREAD_QUOTE_HTML_MAX_CHARS,
): string {
  const sorted = [...messages].sort(
    (a, b) => Date.parse(b.sent_at ?? '') - Date.parse(a.sent_at ?? '') || 0,
  );
  const blocks: string[] = [];
  let total = 0;
  for (const m of sorted) {
    let content = messageQuoteContent(m);
    if (!content.trim()) continue;
    // 1 通だけで上限を超える HTML(大きなメルマガ等)は、テキストにして入れる
    if (content.length > maxChars) {
      content = textToHtml(
        stripQuotedLines(quoteSourceText({ text_body: m.text_body, html_body: m.html_body })),
      ).slice(0, maxChars);
    }
    const block = `<div style="${HEAD_STYLE}">${escapeHtml(quoteHeadLine(m))}</div><blockquote style="${BLOCKQUOTE_STYLE}">${content}</blockquote>`;
    if (blocks.length > 0 && total + block.length > maxChars) {
      blocks.push(`<p style="${HEAD_STYLE}">(これより前のやり取りは省略しました)</p>`);
      break;
    }
    blocks.push(block);
    total += block.length;
  }
  if (blocks.length === 0) return '';
  return `<div class="${CRM_QUOTE_CLASS}">${blocks.join('')}</div>`;
}
