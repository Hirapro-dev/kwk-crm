/**
 * 返信フォームの引用を「スレッドのやり取り全部」にする(2026-10-20 ユーザー要望)。
 * 意図: 新しいメールから順に、各メールの本文を "> " 付きで並べる。各メールに既に入っている引用(> の行と、その直前の「…:」の行)は
 *       別に並べるので外し、同じ文章を何重にも入れない。長くなりすぎたら古い方を省略する(送信の本文上限 50,000 文字に収める)。
 */
import { buildThreadQuote, stripQuotedLines } from '@/lib/domain/mail_text';
import { describe, expect, it } from 'vitest';

const msg = (
  o: Partial<{
    from_address: string;
    from_name: string | null;
    sent_at: string;
    text_body: string;
  }>,
) => ({
  from_address: 'a@example.com',
  from_name: null,
  sent_at: '2026-10-01T00:00:00+00:00',
  text_body: '',
  html_body: null,
  ...o,
});

describe('stripQuotedLines', () => {
  it('> で始まる行と、その直前の「…:」の行を外す', () => {
    const body =
      '了解しました\n\n2026年10月6日(月) 11:21 GPP <s@x.jp>:\n> 前のメール\n> 2行目\n\n以上';
    expect(stripQuotedLines(body)).toBe('了解しました\n\n以上');
  });
  it('引用が無ければそのまま(末尾の空行は詰める)', () => {
    expect(stripQuotedLines('本文\n\n')).toBe('本文');
  });
});

describe('buildThreadQuote', () => {
  it('新しいメールから順に、各メールを日時・差出人の行 + "> " で並べる', () => {
    const q = buildThreadQuote([
      msg({
        from_address: 'cust@x.com',
        sent_at: '2026-10-01T00:00:00+00:00',
        text_body: '最初の問合せ',
      }),
      msg({
        from_address: 'support@x.jp',
        from_name: 'サポート',
        sent_at: '2026-10-02T00:00:00+00:00',
        text_body: '回答です\n\n> 最初の問合せ',
      }),
    ]);
    expect(q).toBe(
      '2026/10/02 09:00 サポート <support@x.jp>:\n> 回答です\n\n2026/10/01 09:00 cust@x.com:\n> 最初の問合せ',
    );
  });
  it('長すぎるときは古い方を省略して、その旨を書く', () => {
    const big = 'あ'.repeat(600);
    const q = buildThreadQuote(
      [
        msg({ text_body: big, sent_at: '2026-10-01T00:00:00+00:00' }),
        msg({ text_body: big, sent_at: '2026-10-02T00:00:00+00:00' }),
      ],
      1000,
    );
    expect(q).toContain('2026/10/02');
    expect(q).not.toContain('2026/10/01');
    expect(q).toContain('これより前のやり取りは省略しました');
  });
  it('メールが無ければ空', () => {
    expect(buildThreadQuote([])).toBe('');
  });
});
