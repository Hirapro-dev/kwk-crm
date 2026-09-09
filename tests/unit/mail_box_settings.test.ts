import { describe, expect, it } from 'vitest';
import {
  dkimCnameRecords,
  normalizeMailBoxAddress,
  uniqueDomains,
} from '../../lib/domain/mail_box_settings';

/**
 * `/settings/mail` の決定論的ロジック(CLAUDE.md §5.15)。
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
