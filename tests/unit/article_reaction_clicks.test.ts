import {
  dedupeClickRows,
  jstDateOf,
  matchLegacyReactions,
  matchReactionsByEmail,
  normalizeName,
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
    expect(r.linked).toEqual([{ id: 'r1', memberId: 'K-1', memberName: '会員1', by: 'email' }]);
  });
  // 意図: 配信ツールに登録したメールが CRM の会員と違う人を、氏名(空白を除いて一致)が 1 人だけなら拾う(2026-09-23)
  it('メールで当たらない行は、氏名が一致する会員が 1 人だけなら紐付ける(同名が複数なら複数候補)', () => {
    const ms = [
      ...members,
      { id: 'K-10', name: '久保田 雄樹', email1: 'k@freebit.jp', email2: null, email3: null },
      { id: 'K-11', name: '田中 一郎', email1: null, email2: null, email3: null },
      { id: 'K-12', name: '田中一郎', email1: null, email2: null, email3: null },
    ];
    const r = matchReactionsByEmail(
      [
        { id: 'r1', email: 'kiiyuk@outlook.jp', name: '久保田雄樹' },
        { id: 'r2', email: 'zz@example.com', name: '田中一郎' },
        { id: 'r3', email: 'y@example.com', name: '' },
      ],
      ms,
    );
    expect(r.linked).toEqual([
      { id: 'r1', memberId: 'K-10', memberName: '久保田 雄樹', by: 'name' },
    ]);
    expect(r.multiple).toEqual(['r2']);
    expect(r.none).toEqual(['r3']);
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

describe('matchLegacyReactions', () => {
  // 意図: Salesforce 形式で既に入っている同じ記事・同じ日の反応を二重に作らない(§5.13b。2026-09-23)。
  // 人の一致は 会員のメール または 会員氏名(空白を除く)。記事名は呼び出し側で絞る前提
  const click = (email: string, name: string | null, date: string) => ({
    email,
    name,
    registeredAt: `${date}T00:00:00.000Z`,
    registeredDate: date,
    clickCount: 1,
  });
  const legacy = [
    { id: 'KH00000002', member_id: 'K-1', member_name: '山田 太郎', reacted_date: '2026-09-21' },
    { id: 'KH00000001', member_id: null, member_name: '鈴木　花子', reacted_date: '2026-09-21' },
    { id: 'KH00000003', member_id: 'K-1', member_name: '山田 太郎', reacted_date: '2026-09-20' },
  ];
  const emails = new Map([['K-1', ['A@example.com']]]);
  const byDate = (r: { registeredDate: string }) => r.registeredDate;

  it('同じ日付で会員のメールが一致すれば既存行に当たる(メール一致を優先)', () => {
    const r = matchLegacyReactions(
      [click('a@example.com', null, '2026-09-21')],
      legacy,
      emails,
      byDate,
    );
    expect(r).toEqual([{ email: 'a@example.com', existingId: 'KH00000002', by: 'email' }]);
  });
  it('メールが無ければ会員氏名(空白を除く)で当たる', () => {
    const r = matchLegacyReactions(
      [click('x@example.com', '鈴木花子', '2026-09-21')],
      legacy,
      emails,
      byDate,
    );
    expect(r).toEqual([{ email: 'x@example.com', existingId: 'KH00000001', by: 'name' }]);
  });
  it('日付が違えば当たらない。氏名も空なら当たらない', () => {
    expect(
      matchLegacyReactions([click('a@example.com', null, '2026-09-22')], legacy, emails, byDate),
    ).toEqual([]);
    expect(
      matchLegacyReactions([click('x@example.com', '', '2026-09-21')], legacy, emails, byDate),
    ).toEqual([]);
  });
  it('画面で指定した日付で比較できる', () => {
    const r = matchLegacyReactions(
      [click('a@example.com', null, '2026-09-23')],
      legacy,
      emails,
      () => '2026-09-20',
    );
    expect(r[0]?.existingId).toBe('KH00000003');
  });
  it('normalizeName は半角・全角の空白を除く', () => {
    expect(normalizeName(' 山田　太郎 ')).toBe('山田太郎');
  });
});
