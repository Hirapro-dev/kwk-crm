import { describe, expect, it } from 'vitest';
import { MAIL_TABS, mailTabFilter, resolveMailTab } from '../../lib/domain/mail_tabs';

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

/**
 * フォルダ「取込候補」(migration 82)では状態タブを適用しない(2026-09-14)。
 * 候補は状態・分類を問わず全件を見渡して仕訳したいため。他のフォルダは従来どおり。
 */
describe('mailTabFilter', () => {
  it('通常のフォルダではタブの status / category をそのまま絞り込みに使う', () => {
    expect(mailTabFilter(resolveMailTab('active'), { importCandidate: false })).toEqual({
      status: '対応中',
      category: '通常',
    });
  });

  it('「取込候補」では状態タブを適用しない(状態・分類で絞らない)', () => {
    expect(mailTabFilter(resolveMailTab('new'), { importCandidate: true })).toEqual({});
    expect(mailTabFilter(resolveMailTab('spam'), { importCandidate: true })).toEqual({});
  });
});
