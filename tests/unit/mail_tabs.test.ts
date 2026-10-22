import { describe, expect, it } from 'vitest';
import { MAIL_TABS, mailTabFilter, resolveMailTab } from '../../lib/domain/mail_tabs';
import { MAIL_MANUAL_STATUSES, MAIL_STATUSES } from '../../lib/domain/mail_types';

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
    // 「対応中」タブは 対応中 + 承認待ち(migration 129)
    expect(mailTabFilter(resolveMailTab('active'), { importCandidate: false })).toEqual({
      status: ['対応中', '承認待ち'],
      category: '通常',
    });
  });

  it('「取込候補」では状態タブを適用しない(状態・分類で絞らない)', () => {
    expect(mailTabFilter(resolveMailTab('new'), { importCandidate: true })).toEqual({});
    expect(mailTabFilter(resolveMailTab('spam'), { importCandidate: true })).toEqual({});
  });
});

/**
 * 承認待ち(migration 129。2026-10-22 ユーザー指定)。返信が承認待ちの間はスレッドを「承認待ち」にし、「対応中」タブに出す。
 * 状態は送信待ちメールに合わせて自動で切り替えるので、手で選べる状態には入れない(食い違わないように)。
 */
describe('承認待ち', () => {
  it('「対応中」タブは 対応中 と 承認待ち の両方を出す', () => {
    expect(resolveMailTab('active').status).toEqual(['対応中', '承認待ち']);
  });
  it('「新着」「対応完了」には承認待ちを含めない', () => {
    expect(resolveMailTab('new').status).toBe('未対応');
    expect(resolveMailTab('done').status).toBe('完了');
  });
  it('承認待ちは状態の一つだが、手で選べる状態には入れない', () => {
    expect(MAIL_STATUSES).toContain('承認待ち');
    expect(MAIL_MANUAL_STATUSES).toEqual(['未対応', '対応中', '完了']);
  });
});
