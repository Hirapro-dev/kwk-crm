import { describe, expect, it } from 'vitest';
import {
  classifyMailSearchQuery,
  escapeLikeWildcards,
  jstDateRangeToUtcIso,
} from '../../lib/domain/mail_search';

/**
 * メーラーのヘッダー検索(CLAUDE.md §5.15)。
 * 「会員ID / メールアドレス / キーワード」のどれとして扱うかは、後続の検索方法
 * (完全一致か部分一致か、RPC を呼ぶか)を左右するため、判定基準を固定する。
 */

describe('classifyMailSearchQuery', () => {
  it('"K-" + 数字は会員IDとして、9桁ゼロ埋めに正規化する', () => {
    expect(classifyMailSearchQuery('K-000012332')).toEqual({
      kind: 'member_id',
      value: 'K-000012332',
    });
    expect(classifyMailSearchQuery('K-12332')).toEqual({
      kind: 'member_id',
      value: 'K-000012332',
    });
    expect(classifyMailSearchQuery('k12332')).toEqual({
      kind: 'member_id',
      value: 'K-000012332',
    });
  });

  it('"@" を含めばメールアドレス(小文字化する)', () => {
    expect(classifyMailSearchQuery('Taro@Example.com')).toEqual({
      kind: 'email',
      value: 'taro@example.com',
    });
  });

  it('それ以外はキーワード', () => {
    expect(classifyMailSearchQuery('お見積りについて')).toEqual({
      kind: 'keyword',
      value: 'お見積りについて',
    });
  });

  it('10桁以上の数字は会員IDと誤認しない(キーワード扱い)', () => {
    expect(classifyMailSearchQuery('K-1234567890')?.kind).toBe('keyword');
  });

  it('空・空白のみは null(検索条件なし)', () => {
    expect(classifyMailSearchQuery('')).toBeNull();
    expect(classifyMailSearchQuery('   ')).toBeNull();
    expect(classifyMailSearchQuery(null)).toBeNull();
  });
});

describe('escapeLikeWildcards', () => {
  it('% と _ をバックスラッシュでエスケープする', () => {
    expect(escapeLikeWildcards('50%_off')).toBe('50\\%\\_off');
  });
  it('該当文字が無ければそのまま', () => {
    expect(escapeLikeWildcards('hello')).toBe('hello');
  });
});

describe('jstDateRangeToUtcIso', () => {
  it('日本時間のその日の開始・終了を UTC の ISO にする', () => {
    const { fromIso, toIso } = jstDateRangeToUtcIso('2026-09-11', '2026-09-11');
    expect(fromIso).toBe('2026-09-10T15:00:00.000Z');
    expect(toIso).toBe('2026-09-11T14:59:59.999Z');
  });

  it('片方だけの指定にも対応する', () => {
    expect(jstDateRangeToUtcIso('2026-09-11', undefined)).toEqual({
      fromIso: '2026-09-10T15:00:00.000Z',
    });
    expect(jstDateRangeToUtcIso(undefined, '2026-09-11')).toEqual({
      toIso: '2026-09-11T14:59:59.999Z',
    });
  });

  it('不正な形式は無視する(黙って別の日付にしない)', () => {
    expect(jstDateRangeToUtcIso('2026/09/11', '不正')).toEqual({});
    expect(jstDateRangeToUtcIso('', '')).toEqual({});
  });
});
