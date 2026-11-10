import {
  planCopyAttachments,
  resolveCopyBoxId,
  sentMailCopyText,
  splitSignature,
} from '@/lib/domain/mail_copy';
import { describe, expect, it } from 'vitest';

// 送信済みメールの「コピーして編集」(CLAUDE.md §5.15「送信済みメールのコピー」)。
// 値はすべて架空のもの。

const sig = (id: number, body: string, is_active = true) => ({
  id,
  name: `署名${id}`,
  body,
  is_active,
});

describe('sentMailCopyText(コピーする本文)', () => {
  it('送信待ちの記録があればその本文(本文 + 署名)を使う', () => {
    expect(
      sentMailCopyText({
        outboxText: '本文です\n\n山田\n',
        textBody: '本文です\n\n山田\n\n2026/11/01 a@x.com:\n> 前のメール',
        htmlBody: null,
      }),
    ).toBe('本文です\n\n山田');
  });

  it('送信待ちの本文に引用が入っている(古い形式)なら外す', () => {
    expect(
      sentMailCopyText({
        outboxText: 'ご連絡です\n\n2026/10/01 10:00 a@x.com:\n> こんにちは\n>\n> 以上',
        textBody: null,
        htmlBody: null,
      }),
    ).toBe('ご連絡です');
  });

  it('送信待ちの記録が無ければ保存した本文から引用を外す(メールディーラー取込分など)', () => {
    expect(
      sentMailCopyText({
        outboxText: null,
        textBody: 'お世話になります。\r\n\r\n> 元のメール\r\n',
        htmlBody: null,
      }),
    ).toBe('お世話になります。');
  });

  it('テキスト版が無ければ HTML をテキストにする', () => {
    expect(
      sentMailCopyText({ outboxText: null, textBody: '', htmlBody: '<p>一行目</p><p>二行目</p>' }),
    ).toBe('一行目\n二行目');
  });

  it('何も無ければ空文字', () => {
    expect(sentMailCopyText({ outboxText: null, textBody: null, htmlBody: null })).toBe('');
  });
});

describe('splitSignature(末尾の署名を外して、その署名を選ぶ)', () => {
  const sigs = [sig(1, '山田\nexample社'), sig(2, 'example社'), sig(3, '旧署名', false)];

  it('末尾が署名と一致したら本文から外し、その署名の id を返す', () => {
    expect(splitSignature('本文です\n\n山田\nexample社\n', sigs)).toEqual({
      text: '本文です',
      signatureId: '1',
    });
  });

  it('複数の署名に一致するときは長い方を優先する', () => {
    // 「example社」(id 2)も末尾に一致するが、より長い id 1 を選ぶ(短い方だと「山田」が本文に残る)
    expect(splitSignature('本文\n\n山田\nexample社', sigs).signatureId).toBe('1');
  });

  it('署名の前の「-- 」の区切り行も外す(2026-10-21 より前の形式)', () => {
    expect(splitSignature('本文です\n\n-- \n山田\nexample社\n', sigs)).toEqual({
      text: '本文です',
      signatureId: '1',
    });
  });

  it('改行コードが CRLF でも一致する', () => {
    expect(splitSignature('本文\r\n\r\n山田\r\nexample社\r\n', sigs).signatureId).toBe('1');
  });

  it('無効な署名には一致させない(選べない署名を選ばない)', () => {
    expect(splitSignature('本文\n\n旧署名', sigs)).toEqual({
      text: '本文\n\n旧署名',
      signatureId: '',
    });
  });

  it('一致しなければ全文を本文にして「署名なし」', () => {
    expect(splitSignature('本文だけ\n', sigs)).toEqual({ text: '本文だけ', signatureId: '' });
  });

  it('本文が署名だけなら本文は空', () => {
    expect(splitSignature('example社', sigs)).toEqual({ text: '', signatureId: '2' });
  });

  it('行の途中で一致しただけでは外さない', () => {
    // 「株式会社example社」の末尾が「example社」と一致しても、署名の行ではない
    expect(splitSignature('本文\n株式会社example社', sigs)).toEqual({
      text: '本文\n株式会社example社',
      signatureId: '',
    });
  });
});

describe('planCopyAttachments(コピーする添付)', () => {
  const file = (
    filename: string,
    content_type: string,
    size_bytes = 1000,
    content_id: string | null = null,
  ) => ({ filename, content_type, size_bytes, storage_path: `p/${filename}`, content_id });

  it('通常の添付はすべてコピーする', () => {
    const r = planCopyAttachments(
      [file('見積書.pdf', 'application/pdf'), file('表.xlsx', 'application/octet-stream')],
      '本文',
    );
    expect(r.skipped).toEqual([]);
    expect(r.accepted.map((a) => [a.filename, a.contentType, a.inline])).toEqual([
      ['見積書.pdf', 'application/pdf', false],
      ['表.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', false],
    ]);
    expect(r.accepted[0]?.storagePath).toBe('p/見積書.pdf');
  });

  it('本文中の画像は、本文に目印があるものだけ本文中の画像として戻す', () => {
    const r = planCopyAttachments(
      [file('a.png', 'image/png', 10, 'cid-a'), file('b.png', 'image/png', 10, 'cid-b')],
      '前\n[画像: a.png]\n後',
    );
    // b.png は目印が無い = 送られていないので付けない
    expect(r.accepted.map((a) => [a.filename, a.inline])).toEqual([['a.png', true]]);
    expect(r.skipped).toEqual([]);
  });

  it('送れない種類・上限を超える分は付けずに理由を返す', () => {
    const big = 9 * 1024 * 1024;
    const r = planCopyAttachments(
      [
        file('a.zip', 'application/zip'),
        file('1.pdf', 'application/pdf', big),
        file('2.pdf', 'application/pdf', big),
      ],
      '',
    );
    expect(r.accepted.map((a) => a.filename)).toEqual(['1.pdf']);
    expect(r.skipped).toHaveLength(2);
    expect(r.skipped[0]).toContain('a.zip');
    expect(r.skipped[1]).toContain('2.pdf');
  });

  it('同じ名前のファイルはずらす', () => {
    const r = planCopyAttachments(
      [file('x.pdf', 'application/pdf'), file('x.pdf', 'application/pdf')],
      '',
    );
    expect(r.accepted.map((a) => a.filename)).toEqual(['x.pdf', 'x (2).pdf']);
  });
});

describe('resolveCopyBoxId(コピー時の送信元)', () => {
  const boxes = [
    { id: 1, address: 'info@example.com' },
    { id: 2, address: 'sales@example.com' },
  ];
  it('送信待ちの受信箱があればそれ', () => {
    expect(resolveCopyBoxId(2, 'info@example.com', boxes)).toBe(2);
  });
  it('無ければ差出人アドレスの受信箱(大文字小文字は区別しない)', () => {
    expect(resolveCopyBoxId(null, 'Sales@Example.com', boxes)).toBe(2);
  });
  it('どれにも当たらなければ null', () => {
    expect(resolveCopyBoxId(null, 'other@example.com', boxes)).toBeNull();
  });
});
