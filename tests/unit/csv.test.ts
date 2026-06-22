import { describe, expect, it } from 'vitest';
import { toCsv } from '../../scripts/migrate/lib/csv';

describe('csv toCsv', () => {
  it('BOM 付きで出力する', () => {
    const out = toCsv([{ a: '1', b: '2' }]);
    expect(out.charCodeAt(0)).toBe(0xfeff);
  });

  it('カンマを含む値をクォートする', () => {
    const out = toCsv([{ a: 'x,y', b: 'z' }]);
    expect(out).toContain('"x,y"');
  });

  it('ダブルクォートをエスケープする', () => {
    const out = toCsv([{ a: 'he"llo' }]);
    expect(out).toContain('"he""llo"');
  });

  it('空配列でも BOM のみで返す', () => {
    const out = toCsv([]);
    expect(out).toBe('\uFEFF');
  });
});
