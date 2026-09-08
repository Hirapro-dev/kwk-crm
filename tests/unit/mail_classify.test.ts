import { describe, expect, it } from 'vitest';
import { classifyInbound, headerLinesToRecord } from '../../lib/domain/mail_inbound';

/**
 * 受信メールの自動分類(CLAUDE.md §5.15)。
 * 「会員からのメールは常に通常」「削除ではなく分類」という前提の要なので、
 * 判定順と各条件をテストで固定する。
 */

const base = {
  headers: {} as Record<string, string>,
  fromAddress: 'someone@example.com',
  subject: 'お問合せ',
  sesSpamFail: false,
  isKnownMember: false,
};

describe('headerLinesToRecord', () => {
  it('キーを小文字にし、値の連続空白をまとめる', () => {
    const r = headerLinesToRecord([
      { key: 'List-Unsubscribe', line: 'List-Unsubscribe: <mailto:u@x>,\r\n <https://x/u>' },
      { key: 'X-Spam-Status', line: 'X-Spam-Status: No, score=2.7 required=3.0' },
    ]);
    expect(r['list-unsubscribe']).toBe('<mailto:u@x>, <https://x/u>');
    expect(r['x-spam-status']).toBe('No, score=2.7 required=3.0');
  });

  it('同名ヘッダは最初の値を採用する', () => {
    const r = headerLinesToRecord([
      { key: 'received', line: 'Received: from a' },
      { key: 'received', line: 'Received: from b' },
    ]);
    expect(r.received).toBe('from a');
  });
});

describe('classifyInbound', () => {
  it('会員として登録済みの差出人は、どの条件に当てはまっても「通常」', () => {
    expect(
      classifyInbound({
        ...base,
        isKnownMember: true,
        sesSpamFail: true,
        headers: { 'list-unsubscribe': '<mailto:x>' },
        subject: '[SPAM] test',
      }),
    ).toBe('通常');
  });

  it('自動応答: Auto-Submitted が no 以外 / mailer-daemon / postmaster', () => {
    expect(classifyInbound({ ...base, headers: { 'auto-submitted': 'auto-replied' } })).toBe(
      '自動応答',
    );
    expect(classifyInbound({ ...base, headers: { 'auto-submitted': 'no' } })).toBe('通常');
    expect(classifyInbound({ ...base, fromAddress: 'mailer-daemon@sv101.xserver.jp' })).toBe(
      '自動応答',
    );
    expect(classifyInbound({ ...base, fromAddress: 'postmaster@example.com' })).toBe('自動応答');
  });

  it('迷惑メール: SES の判定 / X-Spam-Flag / X-Spam-Status / 件名の [SPAM]', () => {
    expect(classifyInbound({ ...base, sesSpamFail: true })).toBe('迷惑メール');
    expect(classifyInbound({ ...base, headers: { 'x-spam-flag': 'YES' } })).toBe('迷惑メール');
    expect(
      classifyInbound({ ...base, headers: { 'x-spam-status': 'Yes, score=7.1 required=3.0' } }),
    ).toBe('迷惑メール');
    expect(
      classifyInbound({ ...base, headers: { 'x-spam-status': 'No, score=2.7 required=3.0' } }),
    ).toBe('通常');
    expect(classifyInbound({ ...base, subject: '[SPAM] 儲かる話' })).toBe('迷惑メール');
    expect(classifyInbound({ ...base, subject: 'SPAM対策について' })).toBe('通常');
  });

  it('メルマガ: List-Unsubscribe / List-Id / Precedence bulk|list', () => {
    expect(classifyInbound({ ...base, headers: { 'list-unsubscribe': '<mailto:u@x>' } })).toBe(
      'メルマガ',
    );
    expect(classifyInbound({ ...base, headers: { 'list-id': 'news.example.com' } })).toBe(
      'メルマガ',
    );
    expect(classifyInbound({ ...base, headers: { precedence: 'bulk' } })).toBe('メルマガ');
    expect(classifyInbound({ ...base, headers: { precedence: 'list' } })).toBe('メルマガ');
    expect(classifyInbound({ ...base, headers: { precedence: 'normal' } })).toBe('通常');
  });

  it('判定順: 自動応答 > 迷惑メール > メルマガ', () => {
    expect(
      classifyInbound({
        ...base,
        headers: { 'auto-submitted': 'auto-generated', 'list-id': 'x' },
        sesSpamFail: true,
      }),
    ).toBe('自動応答');
    expect(classifyInbound({ ...base, headers: { 'list-id': 'x' }, sesSpamFail: true })).toBe(
      '迷惑メール',
    );
  });

  it('何も当てはまらなければ「通常」', () => {
    expect(classifyInbound(base)).toBe('通常');
  });
});
