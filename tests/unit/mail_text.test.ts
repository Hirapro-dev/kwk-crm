import { describe, expect, it } from 'vitest';
import { composeOutgoingBody, htmlToPlainText, quoteSourceText } from '../../lib/domain/mail_text';

/**
 * 返信フォームの本文合成(CLAUDE.md §5.15)。
 * 「画面で見えるもの = 送られるもの」を保つため、署名・引用の付け方と
 * HTML しか無いメールの引用テキスト化を固定する。
 */

describe('htmlToPlainText', () => {
  it('タグを外し、ブロック要素と br を改行にし、実体参照を戻す', () => {
    const html =
      '<html><head><style>p{color:red}</style></head><body><p>Hi&nbsp;again!</p><div>A &amp; B<br>C</div></body></html>';
    expect(htmlToPlainText(html)).toBe('Hi again!\nA & B\nC');
  });
  it('script は本文に含めない', () => {
    expect(htmlToPlainText('<p>x</p><script>alert(1)</script>')).toBe('x');
  });
});

describe('quoteSourceText', () => {
  it('テキスト版があればそれを使う', () => {
    expect(quoteSourceText({ text_body: 'plain', html_body: '<p>html</p>' })).toBe('plain');
  });
  it('テキスト版が無ければ HTML をテキスト化する', () => {
    expect(quoteSourceText({ text_body: null, html_body: '<p>html</p>' })).toBe('html');
  });
});

describe('composeOutgoingBody', () => {
  it('本文 → "-- " 区切りの署名 → 引用 の順に並べ、末尾は改行1つ', () => {
    expect(
      composeOutgoingBody({ text: 'お世話になります。', signature: '株式会社X', quote: '> 元' }),
    ).toBe('お世話になります。\n\n-- \n株式会社X\n\n> 元\n');
  });
  it('署名・引用が無ければ本文だけ', () => {
    expect(composeOutgoingBody({ text: '本文  \n' })).toBe('本文\n');
  });
  it('本文が空でも引用だけ送れる形にはならない(呼び出し側で本文必須にする前提)', () => {
    expect(composeOutgoingBody({ text: '', quote: '> 元' })).toBe('> 元\n');
  });
});
