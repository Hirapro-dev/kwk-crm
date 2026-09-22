import {
  dedupeClickRows,
  jstDateOf,
  matchReactionsByEmail,
  parseJstDateTime,
} from '@/lib/domain/article_reaction_clicks';
import { describe, expect, it } from 'vitest';

/**
 * 記事反応リスト: クリック履歴 CSV の取込(CLAUDE.md §5.13b)。
 * 意図: 同じ人の複数クリックを 1 件にまとめ、会員照合はメールの完全一致だけで行う(誤紐付けを防ぐ)。
 */
describe('parseJstDateTime', () => {
  it('配信ツールの "YYYY-MM-DD HH:mm:ss" を日本時間として UTC に直す', () => {
    expect(parseJstDateTime('2026-09-23 08:00:35')).toBe('2026-09-22T23:00:35.000Z');
  });
  it('スラッシュ区切り・秒なし・ゼロ埋めなしも受ける', () => {
    expect(parseJstDateTime('2026/9/3 8:05')).toBe('2026-09-02T23:05:00.000Z');
    expect(parseJstDateTime('2026/9/3')).toBe('2026-09-02T15:00:00.000Z');
  });
  it('解釈できない値・存在しない日付は null', () => {
    expect(parseJstDateTime('')).toBeNull();
    expect(parseJstDateTime('昨日')).toBeNull();
    expect(parseJstDateTime('2026-02-30 10:00:00')).toBeNull();
  });
  it('jstDateOf は日本時間の日付を返す(UTC では前日でも)', () => {
    expect(jstDateOf('2026-09-22T23:00:35.000Z')).toBe('2026-09-23');
  });
});

describe('dedupeClickRows', () => {
  it('同じメールアドレス(大文字小文字の違いを含む)は 1 件にまとめ、最初のクリックと空でない名前を残す', () => {
    const r = dedupeClickRows([
      { clickedAt: '2026-09-23 08:00:35', email: 'A@example.com', name: '' },
      { clickedAt: '2026-09-23 07:50:37', email: 'a@example.com', name: '山田' },
      { clickedAt: '2026-09-23 07:55:00', email: 'b@example.com', name: '' },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toEqual({
      email: 'a@example.com',
      name: '山田',
      registeredAt: '2026-09-22T22:50:37.000Z',
      registeredDate: '2026-09-23',
      clickCount: 2,
    });
    expect(r.rows[1]?.name).toBeNull();
  });
  it('メールが空・不正、日時が読めない行はエラーにして取り込まない', () => {
    const r = dedupeClickRows([
      { clickedAt: '2026-09-23 08:00:35', email: '', name: '' },
      { clickedAt: '2026-09-23 08:00:35', email: 'not-an-email', name: '' },
      { clickedAt: '??', email: 'c@example.com', name: '' },
    ]);
    expect(r.rows).toEqual([]);
    expect(r.errors.map((e) => e.row)).toEqual([1, 2, 3]);
  });
});

describe('matchReactionsByEmail', () => {
  const members = [
    { id: 'K-1', name: '会員1', email1: 'A@example.com', email2: null, email3: null },
    { id: 'K-2', name: '会員2', email1: 'x@example.com', email2: 'dup@example.com', email3: null },
    { id: 'K-3', name: '会員3', email1: null, email2: null, email3: 'dup@example.com' },
  ];
  it('email1〜3 のどれかに完全一致(小文字化)した会員が 1 人なら紐付ける', () => {
    const r = matchReactionsByEmail([{ id: 'r1', email: 'a@example.com' }], members);
    expect(r.linked).toEqual([{ id: 'r1', memberId: 'K-1', memberName: '会員1' }]);
  });
  it('複数の会員が同じメールなら紐付けず「複数」、いなければ「該当なし」、メール無しは「メールなし」', () => {
    const r = matchReactionsByEmail(
      [
        { id: 'r1', email: 'dup@example.com' },
        { id: 'r2', email: 'zzz@example.com' },
        { id: 'r3', email: null },
      ],
      members,
    );
    expect(r.linked).toEqual([]);
    expect(r.multiple).toEqual(['r1']);
    expect(r.none).toEqual(['r2']);
    expect(r.noEmail).toEqual(['r3']);
  });
  it('部分一致では紐付けない(誤紐付け防止)', () => {
    const r = matchReactionsByEmail([{ id: 'r1', email: 'a@example.co' }], members);
    expect(r.none).toEqual(['r1']);
  });
});
