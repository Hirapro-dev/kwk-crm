import { describe, expect, it } from 'vitest';
import {
  dkimCnameRecords,
  normalizeMailBoxAddress,
  reassignRanges,
  uniqueDomains,
} from '../../lib/domain/mail_box_settings';

/**
 * `/mail/settings` の決定論的ロジック(CLAUDE.md §5.15)。
 * 受信箱アドレスは受信時の宛先判定キーになるため、正規化(小文字化)と形式チェックを固定する。
 * DKIM の CNAME は利用者が DNS に手で貼るため、SES の仕様どおりの形であることを固定する。
 */

describe('normalizeMailBoxAddress', () => {
  it('小文字化し前後の空白を除く(受信時の宛先判定が小文字比較のため)', () => {
    expect(normalizeMailBoxAddress('  Info@Hirapro.JP ')).toEqual({ address: 'info@hirapro.jp' });
  });
  it('空・形式不正はエラーにする(黙って登録しない)', () => {
    expect(normalizeMailBoxAddress('').error).toBeTruthy();
    expect(normalizeMailBoxAddress('not-an-address').error).toBeTruthy();
    expect(normalizeMailBoxAddress('a@b').error).toBeTruthy();
    expect(normalizeMailBoxAddress('"x" <a@b.jp>').error).toBeTruthy();
  });
});

describe('dkimCnameRecords', () => {
  it('SES 仕様の CNAME 3本を組み立てる', () => {
    const r = dkimCnameRecords('hirapro.jp', ['aaa', 'bbb', 'ccc']);
    expect(r).toHaveLength(3);
    expect(r[0]).toEqual({
      host: 'aaa._domainkey.hirapro.jp',
      hostLabel: 'aaa._domainkey',
      type: 'CNAME',
      value: 'aaa.dkim.amazonses.com',
    });
  });
  it('トークンが無ければ空', () => {
    expect(dkimCnameRecords('hirapro.jp', [])).toEqual([]);
  });
});

describe('uniqueDomains', () => {
  it('重複を除き昇順に並べる', () => {
    expect(uniqueDomains(['b@kawaraban.co.jp', 'a@hirapro.jp', 'c@kawaraban.co.jp'])).toEqual([
      'hirapro.jp',
      'kawaraban.co.jp',
    ]);
  });
});

describe('reassignRanges', () => {
  it('2016 年より前 / 2016〜2017 年 / 以降は 1 年ずつ今年まで、隙間なく連続する(全件 1 回だと DB の 8 秒制限で止まるため)', () => {
    const r = reassignRanges(2026);
    expect(r[0]).toEqual({
      from: '2000-01-01T00:00:00Z',
      to: '2016-01-01T00:00:00Z',
      label: '2016 年より前',
    });
    expect(r[1]?.to).toBe('2018-01-01T00:00:00Z');
    expect(r.at(-1)).toEqual({
      from: '2026-01-01T00:00:00Z',
      to: '2027-01-01T00:00:00Z',
      label: '2026 年',
    });
    for (let i = 1; i < r.length; i++) expect(r[i]?.from).toBe(r[i - 1]?.to);
    expect(r).toHaveLength(2 + (2026 - 2018 + 1));
  });
});
