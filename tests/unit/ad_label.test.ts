import { describe, expect, it } from 'vitest';
import { adLabel } from '../../lib/domain/ad_label';

/**
 * 広告ID の表示(CLAUDE.md §5.18)。問合せ・会員・LP の広告ID に広告マスタの媒体名を併記する。
 * マスタに無い ID はそのまま、空は「-」。
 */
describe('adLabel', () => {
  const names = { N0000003: '【KAWARA版広告】○○メールマガジン', N9999900: 'Google広告' };
  it('マスタにある ID は「ID 媒体名」、無い ID は ID だけ、空は「-」', () => {
    expect(adLabel('N0000003', names)).toBe('N0000003 【KAWARA版広告】○○メールマガジン');
    expect(adLabel('N0000999', names)).toBe('N0000999');
    expect(adLabel(null, names)).toBe('-');
    expect(adLabel('', names)).toBe('-');
    expect(adLabel('  ', names)).toBe('-');
  });
  it('前後の空白は無視して引く', () => {
    expect(adLabel(' N9999900 ', names)).toBe('N9999900 Google広告');
  });
});
