import {
  MAX_SIGNATURE_BODY_CHARS,
  type SignatureOption,
  defaultSignatureValue,
  normalizeSignatureBody,
  normalizeSignatureName,
  signatureBodyOf,
} from '@/lib/domain/mail_signatures';
import { describe, expect, it } from 'vitest';

/**
 * 署名マスタ(CLAUDE.md §5.15「署名」)の純粋関数。
 * 「受信箱の既定署名 → フォームの初期選択」は無効化済みの署名を黙って付けないことが要点。
 */

const sigs: SignatureOption[] = [
  { id: 1, name: '営業部', body: '株式会社〇〇 営業部\nTEL 00-0000-0000', is_active: true },
  { id: 2, name: '旧署名', body: '古い署名', is_active: false },
];

describe('defaultSignatureValue', () => {
  it('既定署名が有効なら その id を文字列で返す', () => {
    expect(defaultSignatureValue(1, sigs)).toBe('1');
  });
  it('既定が未設定なら 署名なし', () => {
    expect(defaultSignatureValue(null, sigs)).toBe('');
    expect(defaultSignatureValue(undefined, sigs)).toBe('');
  });
  it('既定の署名が存在しない / 無効化済みなら 署名なし(無効な署名を黙って付けない)', () => {
    expect(defaultSignatureValue(99, sigs)).toBe('');
    expect(defaultSignatureValue(2, sigs)).toBe('');
  });
});

describe('signatureBodyOf', () => {
  it('選択値に対応する本文を返し、署名なし・不明な id は空', () => {
    expect(signatureBodyOf('1', sigs)).toBe(sigs[0]?.body);
    expect(signatureBodyOf('', sigs)).toBe('');
    expect(signatureBodyOf('99', sigs)).toBe('');
  });
});

describe('normalizeSignatureBody / normalizeSignatureName', () => {
  it('本文は CRLF を LF にし、前後の空白を除き、空なら null', () => {
    expect(normalizeSignatureBody('  a\r\nb \n')).toBe('a\nb');
    expect(normalizeSignatureBody('   ')).toBeNull();
    expect(normalizeSignatureBody(null)).toBeNull();
  });
  it('本文は上限で切る', () => {
    expect(normalizeSignatureBody('x'.repeat(MAX_SIGNATURE_BODY_CHARS + 10))?.length).toBe(
      MAX_SIGNATURE_BODY_CHARS,
    );
  });
  it('名前は連続空白を 1 つにし、空なら null', () => {
    expect(normalizeSignatureName('  営業部  共通 ')).toBe('営業部 共通');
    expect(normalizeSignatureName('')).toBeNull();
  });
});
