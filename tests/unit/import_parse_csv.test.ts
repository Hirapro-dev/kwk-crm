import { describe, expect, it } from 'vitest';
import { parseCsv } from '../../lib/import/parse';

/**
 * 取込の CSV 解析は、セルの値を整形せずに文字列のまま返す。
 * 以前は xlsx の整形(raw: false)を通していたため、日時の時刻が消え(2018/7/24 22:06 → 7/24/18)、
 * 2 桁年に縮んだ生年月日が 2000 年代と読まれていた(1925/3/4 → 3/4/25 → 2025 年)。
 */
describe('parseCsv(値をそのまま読む)', () => {
  const csv = [
    '会員ID,登録日時,生年月日,登録月,金額,電話番号',
    'K-000000001,2018/7/24 22:06,1925/3/4,2026/09,"1,000",09012345678',
  ].join('\n');

  it('日時の時刻が残る', () => {
    expect(parseCsv(csv)[0]?.登録日時).toBe('2018/7/24 22:06');
  });

  it('古い生年月日の 4 桁の年が残る', () => {
    expect(parseCsv(csv)[0]?.生年月日).toBe('1925/3/4');
  });

  it('年月だけの文字列を日付に作り変えない', () => {
    expect(parseCsv(csv)[0]?.登録月).toBe('2026/09');
  });

  it('桁区切りの金額と先頭 0 の電話番号は文字列のまま', () => {
    const row = parseCsv(csv)[0];
    expect(row?.金額).toBe('1,000');
    expect(row?.電話番号).toBe('09012345678');
  });

  it('空のセルは空文字', () => {
    const rows = parseCsv('会員ID,備考\nK-000000002,\n');
    expect(rows[0]).toEqual({ 会員ID: 'K-000000002', 備考: '' });
  });
});
