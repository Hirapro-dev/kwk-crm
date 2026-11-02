import { describe, expect, it } from 'vitest';
import { groupMemberLinkId } from '../../lib/reports/group_link';

// グループ表示(会員氏名でまとめた結合セル)から会員詳細へリンクするときの会員ID
describe('groupMemberLinkId', () => {
  it('グループ内の行がすべて同じ会員なら、その会員IDを返す', () => {
    const rows = [{ m_link_id: 'K-000000001' }, { m_link_id: 'K-000000001' }];
    expect(groupMemberLinkId(rows, 'm_link_id')).toBe('K-000000001');
  });

  it('同姓同名で別の会員が混ざっていたら null(どちらか一方へ誤ってリンクしない)', () => {
    const rows = [{ m_link_id: 'K-000000001' }, { m_link_id: 'K-000000002' }];
    expect(groupMemberLinkId(rows, 'm_link_id')).toBeNull();
  });

  it('会員IDの無い行が混ざっていたら null', () => {
    expect(groupMemberLinkId([{ m_link_id: 'K-000000001' }, {}], 'm_link_id')).toBeNull();
    expect(groupMemberLinkId([{ m_link_id: '' }], 'm_link_id')).toBeNull();
  });

  it('行が無ければ null', () => {
    expect(groupMemberLinkId([], 'm_link_id')).toBeNull();
  });
});
