import { describe, expect, it } from 'vitest';
import { MAIL_TABS } from '../../lib/domain/mail_tabs';
import {
  type MailThreadCountGroup,
  canCountFromGroups,
  countBoxIds,
  countFromGroups,
} from '../../lib/domain/mail_thread_counts';

/**
 * メーラーの件数表(CLAUDE.md §5.15「件数表」/ migration 136)から件数を出す純粋関数。
 * 画面のタブ・一覧の総件数・取込候補の件数は、これまで mail_threads をその場で数えていた
 * (lib/domain/mail.ts の applyThreadFilters)。件数表から出す数が、それと同じ絞り込みになることを確かめる。
 */
const g = (
  category: string,
  status: string,
  is_read: boolean,
  is_import_candidate: boolean,
  n: number,
): MailThreadCountGroup => ({ category, status, is_read, is_import_candidate, n });

const GROUPS: MailThreadCountGroup[] = [
  g('通常', '未対応', false, false, 10),
  g('通常', '未対応', true, false, 5),
  g('通常', '未対応', false, true, 3),
  g('通常', '対応中', true, false, 7),
  g('通常', '承認待ち', true, false, 2),
  g('通常', '完了', true, false, 100),
  g('通常', '完了', true, true, 40),
  g('メルマガ', '未対応', false, false, 30),
  g('迷惑メール', '未対応', false, true, 4),
];

describe('countFromGroups', () => {
  it('タブ「新着」= 未対応・通常(既読も未読も、取込候補も含む)', () => {
    expect(countFromGroups(GROUPS, { status: '未対応', category: '通常' })).toBe(18);
  });

  it('状態が配列なら、どれかに一致したものを合計する(「対応中」タブ = 対応中 + 承認待ち)', () => {
    expect(countFromGroups(GROUPS, { status: ['対応中', '承認待ち'], category: '通常' })).toBe(9);
  });

  it('分類だけ(「すべて」タブ = 通常の全状態)', () => {
    expect(countFromGroups(GROUPS, { category: '通常' })).toBe(167);
  });

  it('未読のみで絞ると、既読の区分は数えない', () => {
    expect(countFromGroups(GROUPS, { category: '通常', unreadOnly: true })).toBe(13);
  });

  it('取込候補は分類・状態を問わず数える(左フォルダ「取込候補」の未対応数・未読数・一覧の総件数)', () => {
    expect(countFromGroups(GROUPS, { importCandidate: true })).toBe(47);
    expect(countFromGroups(GROUPS, { importCandidate: true, status: '未対応' })).toBe(7);
    expect(countFromGroups(GROUPS, { importCandidate: true, unreadOnly: true })).toBe(7);
  });

  it('条件が無ければ全部(削除済みは件数表に入っていない)', () => {
    expect(countFromGroups(GROUPS, {})).toBe(201);
  });

  it('状態が空配列なら 0 件(その場で数えるときの in() と同じ)', () => {
    expect(countFromGroups(GROUPS, { status: [] })).toBe(0);
  });

  it('件数が文字列で返ってきても数として足す(bigint の受け取り方の違いに備える)', () => {
    const rows = [{ ...g('通常', '未対応', false, false, 0), n: '12' as unknown as number }];
    expect(countFromGroups(rows, { status: '未対応' })).toBe(12);
  });

  it('全タブの件数の合計は、分類ごとの合計と食い違わない(タブ定義と同じ条件で数えている)', () => {
    const byTab: Record<string, number> = Object.fromEntries(
      MAIL_TABS.map((t) => [
        t.key,
        countFromGroups(GROUPS, { status: t.status, category: t.category }),
      ]),
    );
    const tab = (k: string) => byTab[k] ?? Number.NaN;
    expect(tab('new') + tab('active') + tab('done')).toBe(tab('all'));
    expect(tab('newsletter')).toBe(30);
    expect(tab('spam')).toBe(4);
    expect(tab('auto')).toBe(0);
  });
});

describe('canCountFromGroups', () => {
  it('受信箱・状態・分類・未読・取込候補の絞り込みなら件数表から数える', () => {
    expect(canCountFromGroups({})).toBe(true);
    expect(
      canCountFromGroups({ mailBoxId: 3, status: '未対応', category: '通常', unreadOnly: true }),
    ).toBe(true);
    expect(canCountFromGroups({ mailBoxIds: [1, 2], importCandidate: true })).toBe(true);
    expect(canCountFromGroups({ q: '   ' })).toBe(true);
  });

  it('担当・会員・検索語で絞っているときは件数表に区分が無いので、その場で数える', () => {
    expect(canCountFromGroups({ assigneeId: 'u1' })).toBe(false);
    expect(canCountFromGroups({ assigneeId: 'none' })).toBe(false);
    expect(canCountFromGroups({ memberId: 'K-000000001' })).toBe(false);
    expect(canCountFromGroups({ q: 'example@example.com' })).toBe(false);
  });
});

describe('countBoxIds', () => {
  it('受信箱の指定が無ければ全受信箱(null)', () => {
    expect(countBoxIds({})).toBeNull();
  });

  it('1 つの受信箱・受信箱群(「その他(未振り分け)」)はその受信箱だけ', () => {
    expect(countBoxIds({ mailBoxId: 7 })).toEqual([7]);
    expect(countBoxIds({ mailBoxIds: [3, 1, 3] })).toEqual([1, 3]);
  });

  it('受信箱群が空配列なら空(0 件。全受信箱をマイフォルダに入れた人の「その他」)', () => {
    expect(countBoxIds({ mailBoxIds: [] })).toEqual([]);
  });

  it('両方あるときは重なりだけ(その場で数えるときは両方の条件を AND で掛けている)', () => {
    expect(countBoxIds({ mailBoxId: 2, mailBoxIds: [1, 2] })).toEqual([2]);
    expect(countBoxIds({ mailBoxId: 5, mailBoxIds: [1, 2] })).toEqual([]);
  });
});
