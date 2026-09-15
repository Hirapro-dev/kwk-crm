import { describe, expect, it } from 'vitest';
import {
  decideMemberMatch,
  jstDateKey,
  normalizeMatchInput,
} from '../../lib/domain/mail_import_match';

/**
 * メール取込の会員自動照合(CLAUDE.md §5.16)。氏名・電話・メール・住所の4点を
 * 正規化して既存会員と比べ、3点以上一致で自動紐付け、1〜2点は候補、0点は該当なし。
 * 正規化は DB 側の関数(match_members_for_inquiry)と同じ規則にする。
 */
describe('normalizeMatchInput', () => {
  it('氏名・住所は空白と全角半角の違いを無視し小文字化、電話は数字のみで先頭0を除き、メールは小文字化', () => {
    expect(
      normalizeMatchInput({
        name: '山田　太郎',
        phone: '090-1234-5678',
        email: ' Taro@Example.com ',
        address: '東京都渋谷区１－２－３',
      }),
    ).toEqual({
      name: '山田太郎',
      phone: '9012345678',
      email: 'taro@example.com',
      address: '東京都渋谷区1-2-3',
    });
  });
  it('未指定は空文字', () => {
    expect(normalizeMatchInput({})).toEqual({ name: '', phone: '', email: '', address: '' });
  });
});

describe('decideMemberMatch', () => {
  it('3点以上一致する会員が1人なら自動紐付け', () => {
    expect(
      decideMemberMatch([
        { member_id: 'K-1', points: 3 },
        { member_id: 'K-2', points: 1 },
      ]),
    ).toEqual({
      status: 'auto',
      memberId: 'K-1',
      points: 3,
      candidates: ['K-1'],
    });
  });
  it('3点以上が複数なら自動では紐付けず候補にする', () => {
    const r = decideMemberMatch([
      { member_id: 'K-1', points: 4 },
      { member_id: 'K-2', points: 3 },
    ]);
    expect(r.status).toBe('candidates');
    expect(r.memberId).toBeNull();
    expect(r.candidates).toEqual(['K-1', 'K-2']);
  });
  it('1〜2点なら候補(多い順に最大5件)', () => {
    const rows = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => ({
      member_id: id,
      points: i < 2 ? 2 : 1,
    }));
    const r = decideMemberMatch(rows);
    expect(r.status).toBe('candidates');
    expect(r.candidates).toHaveLength(5);
    expect(r.candidates.slice(0, 2)).toEqual(['a', 'b']);
  });
  it('一致なしは該当なし', () => {
    expect(decideMemberMatch([])).toEqual({
      status: 'none',
      memberId: null,
      points: 0,
      candidates: [],
    });
  });
});

describe('jstDateKey', () => {
  it('ISO 日時を日本時間の日付にする', () => {
    expect(jstDateKey('2026-09-14T15:30:00.000Z')).toBe('2026-09-15');
    expect(jstDateKey('2026-09-15T14:59:59.000Z')).toBe('2026-09-15');
    expect(jstDateKey('2026-09-15T15:00:00.000Z')).toBe('2026-09-16');
  });
});
