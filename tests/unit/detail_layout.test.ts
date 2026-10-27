import { DETAIL_GRID_COLUMN_CLASSES, detailLayoutFor } from '@/lib/domain/detail_layout';
import { describe, expect, it } from 'vitest';

// 詳細画面とレイアウトエディタのプレビューは同じ設定を見る。
// ここが変わると両方の見た目が変わるため、現在の列数を固定しておく。
describe('detailLayoutFor', () => {
  it('問合せ・申込は 4 列、会員は 2 列', () => {
    expect(detailLayoutFor('inquiries').columns).toBe(4);
    expect(detailLayoutFor('applications').columns).toBe(4);
    expect(detailLayoutFor('members').columns).toBe(2);
  });

  it('備考は全幅で表示する(問合せは extra のキー「備考」、会員は remarks 列)', () => {
    expect(detailLayoutFor('inquiries').fullWidthFields).toEqual(['備考']);
    expect(detailLayoutFor('members').fullWidthFields).toEqual(['remarks']);
    expect(detailLayoutFor('applications').fullWidthFields).toEqual([]);
  });

  it('未登録のオブジェクトは 2 列・全幅なし(DynamicDetailFields の既定と同じ)', () => {
    expect(detailLayoutFor('lp_entries')).toEqual({ columns: 2, fullWidthFields: [] });
  });

  it('4 列は広い画面(lg)でだけ 4 列になり、狭い画面では 2 列 → 1 列に減る', () => {
    expect(DETAIL_GRID_COLUMN_CLASSES[4]).toBe('grid-cols-1 sm:grid-cols-2 lg:grid-cols-4');
  });
});
