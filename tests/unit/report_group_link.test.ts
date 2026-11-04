import { describe, expect, it } from 'vitest';
import {
  groupMemberLinkId,
  isMemberIdColumn,
  isMemberLinkColumn,
  isMemberNameColumn,
  memberIdAliases,
  rowMemberId,
} from '../../lib/reports/group_link';

/**
 * レポート結果の会員詳細リンク(CLAUDE.md §9.10b)。
 * 「会員氏名・会員ID の列なら、どのレポートタイプで選んでも会員詳細へ飛べる」ことと、
 * 「別人のページや存在しないページへ飛ばさない」ことを固定する。
 */
const HIDDEN = 'm_link_id';

describe('会員の列の判定', () => {
  it('会員ID は会員の項目と、申込・対応歴・問合せ・記事反応の項目のどれでも対象', () => {
    for (const source of [
      'm.id',
      'a.member_id',
      'act.member_id',
      'inq.member_id',
      'ar.member_id',
    ]) {
      expect(isMemberIdColumn({ source })).toBe(true);
    }
  });

  it('会員氏名は会員の項目と記事反応の項目が対象', () => {
    for (const source of ['m.name', 'ar.member_name']) {
      expect(isMemberNameColumn({ source })).toBe(true);
    }
  });

  it('似た名前の列は対象にしない(かな・担当者名・問合せID など)', () => {
    for (const source of ['m.name_kana', 'owner.full_name', 'inq.id', 'a.id', 'a.owner_id']) {
      expect(isMemberLinkColumn({ source })).toBe(false);
    }
  });

  it('集計した列は値が ID や氏名ではないのでリンクにしない', () => {
    expect(isMemberIdColumn({ source: 'm.id', aggregated: true })).toBe(false);
    expect(isMemberNameColumn({ source: 'm.name', aggregated: true })).toBe(false);
  });
});

describe('rowMemberId', () => {
  it('隠し列があればそれを使う', () => {
    expect(rowMemberId({ [HIDDEN]: 'K-000000001' }, [HIDDEN])).toBe('K-000000001');
  });

  it('会員氏名と会員ID を両方選ぶと隠し列が無いので、会員ID の列の値を使う', () => {
    const aliases = memberIdAliases(
      [
        { alias: 'c_name', source: 'm.name' },
        { alias: 'c_id', source: 'm.id' },
      ],
      HIDDEN,
    );
    expect(rowMemberId({ c_name: '架空 太郎', c_id: 'K-000000002' }, aliases)).toBe('K-000000002');
  });

  it('集計した ID 列は候補にしない(件数を会員ID として使わない)', () => {
    const aliases = memberIdAliases([{ alias: 'c_cnt', source: 'm.id', aggregated: true }], HIDDEN);
    expect(rowMemberId({ c_cnt: 5 }, aliases)).toBeNull();
  });

  it('値が空なら null(会員に紐付いていない行)', () => {
    expect(rowMemberId({ [HIDDEN]: null }, [HIDDEN])).toBeNull();
    expect(rowMemberId({ [HIDDEN]: '' }, [HIDDEN])).toBeNull();
    expect(rowMemberId({}, [HIDDEN])).toBeNull();
  });
});

// グループ表示(会員氏名・会員ID でまとめた結合セル)から会員詳細へリンクするときの会員ID
describe('groupMemberLinkId', () => {
  it('グループ内の行がすべて同じ会員なら、その会員IDを返す', () => {
    const rows = [{ m_link_id: 'K-000000001' }, { m_link_id: 'K-000000001' }];
    expect(groupMemberLinkId(rows, [HIDDEN])).toBe('K-000000001');
  });

  it('同姓同名で別の会員が混ざっていたら null(どちらか一方へ誤ってリンクしない)', () => {
    const rows = [{ m_link_id: 'K-000000001' }, { m_link_id: 'K-000000002' }];
    expect(groupMemberLinkId(rows, [HIDDEN])).toBeNull();
  });

  it('会員IDの無い行が混ざっていたら null', () => {
    expect(groupMemberLinkId([{ m_link_id: 'K-000000001' }, {}], [HIDDEN])).toBeNull();
    expect(groupMemberLinkId([{ m_link_id: '' }], [HIDDEN])).toBeNull();
  });

  it('行が無ければ null', () => {
    expect(groupMemberLinkId([], [HIDDEN])).toBeNull();
  });

  it('隠し列が無いレポートは会員ID の列から求める(会員ID でのグループ化)', () => {
    const rows = [{ c_id: 'K-000000003' }, { c_id: 'K-000000003' }];
    expect(groupMemberLinkId(rows, [HIDDEN, 'c_id'])).toBe('K-000000003');
  });
});
