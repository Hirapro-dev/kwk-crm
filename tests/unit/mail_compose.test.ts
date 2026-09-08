import { describe, expect, it } from 'vitest';
import {
  appendSignature,
  buildQuotedBody,
  buildReplyHeaders,
  buildReplySubject,
  formatFromAddress,
  parseAddressList,
  sesMessageIdHeader,
} from '../../lib/domain/mail_compose';

/**
 * メール送信の組み立て(CLAUDE.md §5.15 M2)。
 * 顧客側でのスレッド化(In-Reply-To / References)と、SES が受け付ける差出人表記は
 * 壊れても気づきにくいため、意図をテストで固定する。
 */

describe('buildReplySubject', () => {
  it('Re: を付ける。既にあれば重ねない', () => {
    expect(buildReplySubject('口座について')).toBe('Re: 口座について');
    expect(buildReplySubject('Re: 口座について')).toBe('Re: 口座について');
    expect(buildReplySubject('RE： 口座について')).toBe('RE： 口座について');
  });

  it('件名が無ければ "Re: " だけ', () => {
    expect(buildReplySubject(null)).toBe('Re: ');
  });
});

describe('buildReplyHeaders(顧客側でもスレッド化される)', () => {
  it('In-Reply-To は親の Message-ID、References は親の References + 親の Message-ID', () => {
    const h = buildReplyHeaders({ message_id: '<c@x>', references_header: '<a@x> <b@x>' });
    expect(h.inReplyTo).toBe('<c@x>');
    expect(h.references).toBe('<a@x> <b@x> <c@x>');
  });

  it('親に References が無ければ親の Message-ID だけ', () => {
    expect(buildReplyHeaders({ message_id: '<c@x>', references_header: null }).references).toBe(
      '<c@x>',
    );
  });

  it('親の Message-ID が References に既にあれば重複させない', () => {
    expect(buildReplyHeaders({ message_id: '<c@x>', references_header: '<c@x>' }).references).toBe(
      '<c@x>',
    );
  });
});

describe('appendSignature', () => {
  it('"-- " 区切りで署名を付け、末尾は改行1つ', () => {
    expect(appendSignature('本文\n\n', '株式会社X\n担当')).toBe('本文\n\n-- \n株式会社X\n担当\n');
  });

  it('署名が空なら本文だけ(末尾改行は整える)', () => {
    expect(appendSignature('本文  ', '')).toBe('本文\n');
    expect(appendSignature('本文', null)).toBe('本文\n');
  });
});

describe('buildQuotedBody', () => {
  it('日時と差出人の行の下に、各行を "> " 付きで並べる', () => {
    const q = buildQuotedBody({
      from_address: 'a@example.com',
      from_name: 'テスト太郎',
      sent_at: '2026-06-10T09:00:00+00:00',
      text_body: '1行目\r\n\r\n3行目',
    });
    expect(q).toBe('2026/06/10 18:00 テスト太郎 <a@example.com>:\n> 1行目\n>\n> 3行目');
  });
});

describe('parseAddressList', () => {
  it('カンマ・セミコロン・改行で区切り、表示名付きはアドレスだけにし、重複を除く', () => {
    const r = parseAddressList('a@x.com, "B" <b@x.com>;\nA@X.COM\n');
    expect(r.error).toBeUndefined();
    expect(r.addresses).toEqual(['a@x.com', 'b@x.com']);
  });

  it('不正な形式は黙って捨てずエラーにする', () => {
    expect(parseAddressList('a@x.com, notanaddress').error).toContain('notanaddress');
  });

  it('空は空配列', () => {
    expect(parseAddressList('')).toEqual({ addresses: [] });
    expect(parseAddressList(null)).toEqual({ addresses: [] });
  });
});

describe('formatFromAddress(SES の差出人表記)', () => {
  it('ASCII の表示名は引用符で囲む', () => {
    expect(formatFromAddress('ad@kawaraban.co.jp', 'KAWARA')).toBe('"KAWARA" <ad@kawaraban.co.jp>');
  });

  it('日本語の表示名は RFC 2047 の encoded-word にする(SES は生の非 ASCII を受け付けない)', () => {
    const s = formatFromAddress('ad@kawaraban.co.jp', 'KAWARA版');
    expect(s).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <ad@kawaraban\.co\.jp>$/);
    const b64 = s.match(/\?B\?([^?]+)\?=/)?.[1] ?? '';
    expect(Buffer.from(b64, 'base64').toString('utf8')).toBe('KAWARA版');
  });

  it('表示名が無ければアドレスのみ', () => {
    expect(formatFromAddress('ad@kawaraban.co.jp', null)).toBe('ad@kawaraban.co.jp');
  });
});

describe('sesMessageIdHeader', () => {
  it('リージョンに応じた Message-ID ヘッダの期待値を作る', () => {
    expect(sesMessageIdHeader('abc', 'ap-northeast-1')).toBe('<abc@ap-northeast-1.amazonses.com>');
    expect(sesMessageIdHeader('abc', 'us-east-1')).toBe('<abc@email.amazonses.com>');
  });
});
