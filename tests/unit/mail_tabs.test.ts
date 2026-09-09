import { describe, expect, it } from 'vitest';
import { MAIL_TABS, resolveMailTab } from '../../lib/domain/mail_tabs';

/** メーラーの状態タブ解決(CLAUDE.md §8.1)。既定は「新着 = 未対応 / 通常」 */
describe('resolveMailTab', () => {
  it('未指定・未知の値は「新着」(未対応 / 通常)になる', () => {
    for (const k of [undefined, '', 'nope']) {
      const t = resolveMailTab(k);
      expect(t.key).toBe('new');
      expect(t.status).toBe('未対応');
      expect(t.category).toBe('通常');
    }
  });
  it('「すべて」は状態で絞らず通常分類のみ', () => {
    const t = resolveMailTab('all');
    expect(t.status).toBeUndefined();
    expect(t.category).toBe('通常');
  });
  it('分類タブは状態で絞らない', () => {
    for (const k of ['newsletter', 'auto', 'spam']) {
      expect(resolveMailTab(k).status).toBeUndefined();
    }
  });
  it('タブのキーは重複しない', () => {
    expect(new Set(MAIL_TABS.map((t) => t.key)).size).toBe(MAIL_TABS.length);
  });
});
