import { buildHtmlBody } from '@/lib/domain/mail_outgoing_attachments';
import {
  CRM_QUOTE_CLASS,
  buildThreadQuoteHtml,
  sanitizeQuotedHtml,
} from '@/lib/domain/mail_quote_html';
import { describe, expect, it } from 'vitest';

// 返信の HTML 版の引用(§5.15)。外から届いた HTML をこちらの送信メールに入れるので、
// 「動くもの・送り先で悪さをするものを送らない」ことと「前のやり取りを何重にも入れない」ことを確かめる。
describe('sanitizeQuotedHtml', () => {
  it('スクリプト・style・フォーム・埋め込みは中身ごと外す', () => {
    const out = sanitizeQuotedHtml(
      '<html><head><style>body{color:red}</style></head><body><p>本文</p><script>alert(1)</script><form><input name="x"></form><iframe src="https://e.example"></iframe></body></html>',
    );
    expect(out).toBe('<p>本文</p>');
  });

  it('イベント属性と javascript: の URL を外す(書式とふつうのリンクは残す)', () => {
    const out = sanitizeQuotedHtml(
      '<p style="color:blue" onclick="x()"><a href="javascript:alert(1)">悪</a><a href="https://ok.example/" target="_blank">良</a></p>',
    );
    expect(out).toContain('style="color:blue"');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('<a href="https://ok.example/">良</a>');
    expect(out).not.toContain('target');
  });

  it('空白や制御文字を挟んだ javascript: も外す', () => {
    expect(sanitizeQuotedHtml('<a href="java\tscript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeQuotedHtml('<a href=" JAVASCRIPT:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeQuotedHtml('<img src="data:image/svg+xml,<svg onload=alert(1)>">')).toBe(
      '<img>',
    );
  });

  it('危ない style(expression・画面に貼り付く配置)は属性ごと外す', () => {
    expect(sanitizeQuotedHtml('<div style="width:expression(alert(1))">a</div>')).toBe(
      '<div>a</div>',
    );
    expect(sanitizeQuotedHtml('<div style="position: fixed;top:0">a</div>')).toBe('<div>a</div>');
  });

  it('表や色などの書式はそのまま残す(引用を HTML にする目的)', () => {
    const html = '<table border="1"><tr><td style="background:#ff0">セル</td></tr></table>';
    expect(sanitizeQuotedHtml(html)).toBe(html);
  });

  it('既に入っている引用(blockquote・Gmail・この CRM の引用)は外す', () => {
    const out = sanitizeQuotedHtml(
      `<div>新しい文</div><div class="gmail_quote"><div class="gmail_attr">… wrote:</div><blockquote>古い文</blockquote></div><div class="${CRM_QUOTE_CLASS}">さらに古い文</div>`,
    );
    expect(out).toBe('<div>新しい文</div>');
  });

  it('Outlook の返信見出しから後ろ(前のやり取り)を、直前の区切り線ごと外す', () => {
    const out = sanitizeQuotedHtml(
      '<div>新しい文</div><hr><div id="divRplyFwdMsg">From: 誰か</div><div>古い文</div>',
    );
    expect(out).toBe('<div>新しい文</div>');
  });

  it('本文に埋め込まれた画像(cid:)は代替テキストに置き換える。ふつうの画像は残す', () => {
    const out = sanitizeQuotedHtml(
      '<p><img src="cid:logo@x" alt="ロゴ"><img src="cid:y"><img src="https://img.example/a.png"></p>',
    );
    expect(out).toBe('<p>[画像: ロゴ][画像]<img src="https://img.example/a.png"></p>');
  });

  it('引用を外した結果、何も残らなければ空文字', () => {
    expect(sanitizeQuotedHtml('<blockquote>古い文だけ</blockquote>')).toBe('');
  });

  it('日本語はそのまま(文字参照にしない)', () => {
    expect(sanitizeQuotedHtml('<p>こんにちは &amp; ありがとう</p>')).toBe(
      '<p>こんにちは &amp; ありがとう</p>',
    );
  });
});

describe('buildThreadQuoteHtml', () => {
  const inbound = {
    from_address: 'customer@example.com',
    from_name: 'テスト 太郎',
    sent_at: '2026-10-01T01:00:00Z',
    text_body: 'テキスト版',
    html_body: '<p><b>HTML版</b></p>',
  };
  const outbound = {
    from_address: 'ad@example.co.jp',
    from_name: null,
    sent_at: '2026-10-02T01:00:00Z',
    text_body: 'ご返信です\n\n> 前の文',
    html_body: null,
  };

  it('新しい順に、見出し行 + blockquote で並べる。HTML のあるメールは HTML のまま', () => {
    const out = buildThreadQuoteHtml([inbound, outbound]);
    expect(out.startsWith(`<div class="${CRM_QUOTE_CLASS}">`)).toBe(true);
    // 新しい(送信)が先
    expect(out.indexOf('ad@example.co.jp')).toBeLessThan(out.indexOf('customer@example.com'));
    expect(out).toContain('<b>HTML版</b>');
    // 見出しの差出人名・アドレスはエスケープされる
    expect(out).toContain('テスト 太郎 &lt;customer@example.com&gt;:');
  });

  it('テキストしか無いメールは、テキストの中の引用(> の行)を外して HTML にする', () => {
    const out = buildThreadQuoteHtml([outbound]);
    expect(out).toContain('ご返信です');
    expect(out).not.toContain('前の文');
  });

  it('上限を超えたら古い方を省略してその旨を書く', () => {
    const big = { ...inbound, html_body: `<p>${'あ'.repeat(300)}</p>` };
    const out = buildThreadQuoteHtml(
      [
        { ...big, sent_at: '2026-10-03T00:00:00Z' },
        { ...big, sent_at: '2026-10-02T00:00:00Z' },
        { ...big, sent_at: '2026-10-01T00:00:00Z' },
      ],
      700,
    );
    expect(out).toContain('これより前のやり取りは省略しました');
    expect(out.split('<blockquote').length - 1).toBe(1);
  });

  it('メールが無ければ空文字', () => {
    expect(buildThreadQuoteHtml([])).toBe('');
  });
});

describe('buildHtmlBody(引用つき)', () => {
  it('本文の下に引用の HTML を付ける', () => {
    const out = buildHtmlBody('本文', [], '<div class="crm_quote">Q</div>');
    expect(out).toContain('本文</div><br><div class="crm_quote">Q</div></body>');
  });
  it('引用なしなら従来どおり', () => {
    expect(buildHtmlBody('本文', [])).toContain('本文</div></body>');
  });
});
