/**
 * 添付付きメールの組み立て(CLAUDE.md §5.15「送信メールの添付」)のテスト。
 * 意図: 作ったメールを受信側と同じ mailparser で読み戻し、相手のメールソフトに届く形
 *       (件名・本文・HTML の本文中の画像・PDF の添付・返信のスレッド用ヘッダ・日本語の差出人名)になっていることを確かめる。
 */
import { buildRawMessage } from '@/lib/mail/raw_message';
import { simpleParser } from 'mailparser';
import { describe, expect, it } from 'vitest';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const pdf = Buffer.from('%PDF-1.7 test');

describe('buildRawMessage', () => {
  it('本文中の画像は cid で HTML に入り、PDF は通常の添付になる', async () => {
    const raw = await buildRawMessage({
      fromAddress: 'info@example.com',
      fromName: 'テスト 送信者',
      to: ['to@example.net'],
      cc: ['cc@example.net'],
      subject: '見積書の送付',
      text: 'お世話になります。\n[画像: 地図.png]\nよろしくお願いします。',
      html: '<p>お世話になります。</p><img src="cid:img0@crm"><p>よろしくお願いします。</p>',
      inReplyTo: '<parent@example.net>',
      references: '<root@example.net> <parent@example.net>',
      attachments: [
        { filename: '見積書.pdf', contentType: 'application/pdf', content: pdf, cid: null },
        { filename: '地図.png', contentType: 'image/png', content: png, cid: 'img0@crm' },
      ],
    });
    const m = await simpleParser(raw, { skipImageLinks: true });
    expect(m.subject).toBe('見積書の送付');
    expect(m.from?.value[0]).toMatchObject({ address: 'info@example.com', name: 'テスト 送信者' });
    expect(m.replyTo?.value[0]?.address).toBe('info@example.com');
    expect(m.cc && !Array.isArray(m.cc) ? m.cc.value[0]?.address : null).toBe('cc@example.net');
    expect(m.inReplyTo).toBe('<parent@example.net>');
    expect(m.references).toEqual(['<root@example.net>', '<parent@example.net>']);
    expect(m.text).toContain('[画像: 地図.png]');
    expect(m.html).toContain('cid:img0@crm');

    const byName = new Map(m.attachments.map((a) => [a.filename, a]));
    const pdfPart = byName.get('見積書.pdf');
    expect(pdfPart?.contentDisposition).toBe('attachment');
    expect(pdfPart?.content.equals(pdf)).toBe(true);
    const pngPart = byName.get('地図.png');
    expect(pngPart?.contentDisposition).toBe('inline');
    expect(pngPart?.cid).toBe('img0@crm');
    expect(pngPart?.content.equals(png)).toBe(true);
  });

  it('HTML 本文が無ければテキストと添付だけ(返信ヘッダも付けない)', async () => {
    const raw = await buildRawMessage({
      fromAddress: 'info@example.com',
      to: ['to@example.net'],
      subject: 'a',
      text: '本文',
      attachments: [{ filename: 'a.pdf', contentType: 'application/pdf', content: pdf, cid: null }],
    });
    const m = await simpleParser(raw, { skipImageLinks: true });
    expect(m.html).toBe(false);
    expect(m.text?.trim()).toBe('本文');
    expect(m.inReplyTo).toBeUndefined();
    expect(m.attachments).toHaveLength(1);
  });
});
