import { describe, expect, it } from 'vitest';
import { EDITABLE_INQUIRY_COLUMNS, mergeInquiryExtra } from '../../lib/domain/inquiry_extra_edit';

/**
 * 問合せ詳細の編集(CLAUDE.md §8.1 `/inquiries/[id]`)。可変項目(extra)は項目管理で定義されたキーだけを差し替える。
 */
describe('mergeInquiryExtra', () => {
  it('許可キー(項目管理で定義済み)の編集だけ差し込み、空にしたキーは削除、他のキー(備考など)は残す', () => {
    const cur = { 対象銘柄: 'A', 流入元: 'B', 備考: 'メモ' };
    expect(
      mergeInquiryExtra(
        cur,
        { 対象銘柄: ' C ', 流入元: '', 危険: 'x' },
        new Set(['対象銘柄', '流入元']),
      ),
    ).toEqual({
      対象銘柄: 'C',
      備考: 'メモ',
    });
    expect(mergeInquiryExtra(null, { 対象銘柄: 'A' }, new Set(['対象銘柄']))).toEqual({
      対象銘柄: 'A',
    });
  });
  it('編集できる DB 列は問合せの基本項目だけ(id・会員ID・元メール・照合結果は含まない)', () => {
    expect([...EDITABLE_INQUIRY_COLUMNS].sort()).toEqual(
      [
        'ad_id',
        'address',
        'email',
        'form_id',
        'name',
        'name_kana',
        'phone',
        'postal_code',
        'registered_at',
      ].sort(),
    );
  });
});
