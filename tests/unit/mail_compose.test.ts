import { describe, expect, it } from 'vitest';
import {
  appendSignature,
  buildQuotedBody,
  buildReplyHeaders,
  buildReplySubject,
  findAddressesInText,
  formatFromAddress,
  parseAddressList,
  resolveReplySubject,
  resolveReplyTo,
  sanitizeDisplayName,
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
  it('空行のあとに署名を付け、末尾は改行1つ(「-- 」の区切り行は付けない。2026-10-21)', () => {
    expect(appendSignature('本文\n\n', '株式会社X\n担当')).toBe('本文\n\n株式会社X\n担当\n');
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

// フォーム通知の差出人はフォームの送信システムで、お客様のアドレスは本文にある。
// 返信先を画面で 1 件に書き換えられるようにした(2026-10-29)
describe('resolveReplyTo(返信先の上書き)', () => {
  it('入力が無ければ既定(直近の受信メールの差出人)を使う', () => {
    expect(resolveReplyTo(undefined, ['form@x.com'])).toEqual({ addresses: ['form@x.com'] });
  });

  it('既定も無ければエラー', () => {
    expect(resolveReplyTo(undefined, []).error).toBeTruthy();
  });

  it('入力があればそれを使う(表示名付きはアドレスだけ)', () => {
    expect(resolveReplyTo(' 顧客 <c@y.jp> ', ['form@x.com'])).toEqual({ addresses: ['c@y.jp'] });
  });

  it('空・不正な形式・2 件以上は黙って既定に戻さずエラーにする(誤送信を防ぐ)', () => {
    expect(resolveReplyTo('  ', ['form@x.com']).error).toBe('返信先を入力してください');
    expect(resolveReplyTo('notanaddress', ['form@x.com']).error).toContain(
      '返信先の形式が不正です',
    );
    expect(resolveReplyTo('a@x.com, b@x.com', ['form@x.com']).error).toBe(
      '返信先は 1 件だけ指定してください',
    );
  });
});

describe('findAddressesInText(本文から返信先の候補を拾う)', () => {
  it('出てきた順・小文字・重複なしで、差出人や自社のアドレスは除く', () => {
    const body = [
      'お名前 : 架空 太郎',
      'メール : Kaku.Taro+1@Example.com',
      '控え: kaku.taro+1@example.com',
      '差出人: support@ours.example',
    ].join('\n');
    expect(findAddressesInText(body, ['SUPPORT@ours.example'])).toEqual([
      'kaku.taro+1@example.com',
    ]);
  });

  it('文末の句点は含めない', () => {
    expect(findAddressesInText('連絡先は a@b.co.jp.', [])).toEqual(['a@b.co.jp']);
  });

  it('本文が無ければ空', () => {
    expect(findAddressesInText(null, [])).toEqual([]);
  });

  it('候補は最大 5 件', () => {
    const body = Array.from({ length: 8 }, (_, i) => `u${i}@x.com`).join(' ');
    expect(findAddressesInText(body, [])).toHaveLength(5);
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

describe('sanitizeDisplayName(差出人表示名の正規化)', () => {
  it('前後の空白を取り除く', () => {
    expect(sanitizeDisplayName('  ひらプロ  ')).toBe('ひらプロ');
  });

  it('空・空白のみは null にする(表示名なし = アドレスのみ表示)', () => {
    expect(sanitizeDisplayName('')).toBeNull();
    expect(sanitizeDisplayName('   ')).toBeNull();
    expect(sanitizeDisplayName(null)).toBeNull();
    expect(sanitizeDisplayName(undefined)).toBeNull();
  });

  it('改行・制御文字はヘッダインジェクション対策で除去し、空白1つに畳む', () => {
    expect(sanitizeDisplayName('ひらプロ\r\nBcc: attacker@example.com')).toBe(
      'ひらプロ Bcc: attacker@example.com',
    );
    expect(sanitizeDisplayName('a\tb')).toBe('a b');
  });

  it('連続する空白は1つに畳む', () => {
    expect(sanitizeDisplayName('ひら   プロ')).toBe('ひら プロ');
  });

  it('80文字を超える分は切り詰める', () => {
    const long = 'あ'.repeat(100);
    const result = sanitizeDisplayName(long);
    expect(result).toHaveLength(80);
  });
});

describe('resolveReplySubject(返信の件名を画面で直したとき)', () => {
  // 意図: 返信の件名は画面で書き換えられる(2026-10-28 ユーザー要望)。送らなかったとき(古い画面など)は
  // これまでどおり「Re: 元の件名」。空にしたら送らない。改行は送るメールのヘッダーを壊すので 1 つの空白にする。
  it('指定が無ければ元の件名から作る(Re: を付ける)', () => {
    expect(resolveReplySubject(undefined, '口座について')).toEqual({ subject: 'Re: 口座について' });
  });
  it('指定があればその件名を使う(Re: を勝手に付けない)', () => {
    expect(resolveReplySubject('【再送】口座について', '口座について')).toEqual({
      subject: '【再送】口座について',
    });
  });
  it('前後の空白・改行を除き、連続した空白は 1 つにする', () => {
    expect(resolveReplySubject('  Re:  口座\r\nについて ', 'x')).toEqual({
      subject: 'Re: 口座 について',
    });
  });
  it('空白だけなら件名の入力を求める', () => {
    expect(resolveReplySubject('   ', '口座について').error).toBeTruthy();
  });
});
