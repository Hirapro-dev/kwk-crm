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

describe('classifyInbound(エキスパのフォーム通知。2026-10-23)', () => {
  // 意図: エキスパ(ex-pa.jp)のフォーム登録通知は、お客様の申込み・問合せそのもの(問合せとして取り込む元)。
  // 転送元のサーバーが迷惑メールの印([SPAM] / X-Spam-Flag)を付けることがあり、迷惑メールに埋もれていたため、
  // 迷惑メールの判定より先に「通常」にする。差出人のドメインも見て、件名だけ真似たメールは対象にしない。
  const expa = {
    ...base,
    fromAddress: 'info@ex-pa.jp',
    subject: '[SPAM] [エキスパ]フォーム登録通知 abc123',
    headers: { 'x-spam-flag': 'YES', 'x-spam-status': 'Yes, score=6.1' },
  };
  it('迷惑メールの印が付いていても「通常」', () => {
    expect(classifyInbound(expa)).toBe('通常');
    expect(classifyInbound({ ...expa, sesSpamFail: true })).toBe('通常');
  });
  it('配信停止の情報が付いていても「通常」(メルマガにしない)', () => {
    expect(
      classifyInbound({ ...expa, headers: { 'list-unsubscribe': '<mailto:u@ex-pa.jp>' } }),
    ).toBe('通常');
  });
  it('エキスパのサブドメイン(送信サーバー)からも「通常」', () => {
    expect(classifyInbound({ ...expa, fromAddress: 'noreply@mail.ex-pa.jp' })).toBe('通常');
  });
  it('件名が同じでもエキスパ以外の差出人は、これまでどおり迷惑メールの判定をする', () => {
    expect(classifyInbound({ ...expa, fromAddress: 'spam@example.com' })).toBe('迷惑メール');
    expect(classifyInbound({ ...expa, fromAddress: 'x@notex-pa.jp' })).toBe('迷惑メール');
  });
  it('エキスパからでもフォーム通知でないメール(案内など)は、これまでどおり判定する', () => {
    expect(
      classifyInbound({ ...expa, subject: 'エキスパ通信 10月号', headers: { 'list-id': 'x' } }),
    ).toBe('メルマガ');
  });
});
