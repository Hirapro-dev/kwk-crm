import { describe, expect, it } from 'vitest';
import {
  ensureMessageId,
  extractReferencedMessageIds,
  findInboundBox,
  isBlockedAttachment,
  normalizeSubject,
  parseAddress,
  safeFilename,
} from '../../lib/domain/mail_inbound';

/**
 * メール受信の判定ロジック(CLAUDE.md §5.15)。
 * 会員突合は完全一致、スレッド判定はヘッダのみ、という仕様の前提となる
 * 正規化がここで決まるため、意図をテストで固定する。
 */

describe('parseAddress(会員突合の前処理)', () => {
  it('"氏名 <addr>" を分解し、アドレスは小文字にする', () => {
    expect(parseAddress('山田 太郎 <Taro@Example.com>')).toEqual({
      address: 'taro@example.com',
      name: '山田 太郎',
    });
  });

  it('ダブルクォート付きの表示名は外す', () => {
    expect(parseAddress('"Yamada, Taro" <taro@example.com>').name).toBe('Yamada, Taro');
  });

  it('アドレスのみ / 山括弧のみ にも対応', () => {
    expect(parseAddress('TARO@example.com')).toEqual({ address: 'taro@example.com', name: null });
    expect(parseAddress('<taro@example.com>')).toEqual({ address: 'taro@example.com', name: null });
  });

  it('空・null は address="" を返す(呼び出し側で無視できる)', () => {
    expect(parseAddress(null).address).toBe('');
    expect(parseAddress('   ').address).toBe('');
  });
});

describe('normalizeSubject(表示用の件名。突合には使わない)', () => {
  it('Re: / RE: / Fw: / 返信: / 転送: を繰り返し除去する', () => {
    expect(normalizeSubject('Re: Re: 【お問合せ】口座について')).toBe('【お問合せ】口座について');
    expect(normalizeSubject('RE: FW: 件名')).toBe('件名');
    expect(normalizeSubject('返信: 転送: 件名')).toBe('件名');
    expect(normalizeSubject('Re[2]: 件名')).toBe('件名');
  });

  it('全角コロンにも対応し、連続空白(全角含む)は半角1つにまとめる', () => {
    expect(normalizeSubject('Re：  件名   の　テスト')).toBe('件名 の テスト');
  });

  it('接頭辞でない "Re" は残す', () => {
    expect(normalizeSubject('Report について')).toBe('Report について');
  });

  it('空は空文字', () => {
    expect(normalizeSubject(null)).toBe('');
  });
});

describe('extractReferencedMessageIds(スレッド判定の入力)', () => {
  it('In-Reply-To と References の両方から <...> を取り出し、重複を除いて順序を保つ', () => {
    const ids = extractReferencedMessageIds('<b@x>', '<a@x> <b@x>\r\n <c@x>');
    expect(ids).toEqual(['<b@x>', '<a@x>', '<c@x>']);
  });

  it('どちらも無ければ空配列(= 新規スレッド)', () => {
    expect(extractReferencedMessageIds(null, undefined)).toEqual([]);
  });
});

describe('ensureMessageId(NOT NULL UNIQUE を満たす)', () => {
  it('山括弧が無ければ付ける', () => {
    expect(ensureMessageId('abc@x')).toBe('<abc@x>');
    expect(ensureMessageId(' <abc@x> ')).toBe('<abc@x>');
  });

  it('空なら crm.local ドメインの一意な ID を生成する', () => {
    const a = ensureMessageId('');
    const b = ensureMessageId(null);
    expect(a).toMatch(/^<[0-9a-f-]{36}@crm\.local>$/);
    expect(a).not.toBe(b);
  });
});

describe('findInboundBox(宛先の検証)', () => {
  const boxes = [
    { id: 1, inbound_address: 'inbox@abc123.resend.app' },
    { id: 2, inbound_address: null },
  ];

  it('received_for に受信箱のアドレスがあれば一致する(大文字小文字を無視)', () => {
    expect(findInboundBox(boxes, ['ad@kawaraban.co.jp', 'Inbox@ABC123.resend.app'])?.id).toBe(1);
  });

  it('一致しなければ null(無視する受信)', () => {
    expect(findInboundBox(boxes, ['someone@example.com'])).toBeNull();
  });

  it('inbound_address が未設定の受信箱には一致しない', () => {
    expect(findInboundBox([{ id: 2, inbound_address: null }], ['ad@kawaraban.co.jp'])).toBeNull();
  });
});

describe('添付の扱い', () => {
  it('ファイル名の区切り文字・制御文字を置き換え、拡張子は保つ', () => {
    expect(safeFilename('../a/b:c*.pdf')).toBe('_a_b_c_.pdf');
    expect(safeFilename('')).toBe('attachment');
  });

  it('実行形式は拒否する', () => {
    expect(isBlockedAttachment('invoice.exe')).toBe(true);
    expect(isBlockedAttachment('script.JS')).toBe(true);
    expect(isBlockedAttachment('photo.jpg')).toBe(false);
    expect(isBlockedAttachment('report.pdf')).toBe(false);
  });
});
