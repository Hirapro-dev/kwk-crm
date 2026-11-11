import { describe, expect, it } from 'vitest';
import { decodeCsvBytes } from '../../lib/import/decode';

/** Drive 定期取込の文字コード判定(Shift_JIS の CSV を UTF-8 として読んで文字化けしていた) */
describe('decodeCsvBytes', () => {
  it('UTF-8(BOM 付き)はそのまま読み、BOM を外す', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('会員ID,氏名')]);
    expect(decodeCsvBytes(bytes)).toBe('会員ID,氏名');
  });

  it('UTF-8 として不正なら Shift_JIS として読む', () => {
    // 「会員」の Shift_JIS
    expect(decodeCsvBytes(new Uint8Array([0x89, 0xef, 0x88, 0xf5]))).toBe('会員');
  });
});
