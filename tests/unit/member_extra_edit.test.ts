import { describe, expect, it } from 'vitest';
import { EDITABLE_MEMBER_EXTRA_KEYS, mergeMemberExtra } from '../../lib/domain/member_extra_edit';

/**
 * 会員詳細の編集ダイアログから extra(jsonb)の一部キーを編集する(CLAUDE.md §5.4)。
 * 電話番号2・3 は DB カラムではなく extra のキーとして CSV から取り込まれており、
 * 詳細画面には出るのに編集できなかった。ホワイトリストのキーだけを、他のキー
 * (累計入金額・各案件利用額など)を壊さずに差し替えられることをテストで固定する。
 */
describe('mergeMemberExtra', () => {
  it('電話番号2・3 を編集対象にしている', () => {
    expect(EDITABLE_MEMBER_EXTRA_KEYS).toEqual(['電話番号2', '電話番号3']);
  });

  it('対象キーだけを更新し、他のキーはそのまま残す', () => {
    const merged = mergeMemberExtra(
      { 累計入金額: '1000000', 電話番号2: '0311112222' },
      { 電話番号2: ' 0399998888 ', 電話番号3: '09011112222' },
    );
    expect(merged).toEqual({
      累計入金額: '1000000',
      電話番号2: '0399998888',
      電話番号3: '09011112222',
    });
  });

  it('空にしたキーは削除する(空文字を残さない)', () => {
    const merged = mergeMemberExtra(
      { 電話番号2: '0311112222', 電話番号3: '0322223333' },
      {
        電話番号2: '',
        電話番号3: null,
      },
    );
    expect(merged).toEqual({});
  });

  it('ホワイトリストにないキーは無視する(画面から任意のキーを送られても書き込まない)', () => {
    const merged = mergeMemberExtra({ 累計入金額: '1' }, { 累計入金額: '999', 電話番号2: '03' });
    expect(merged).toEqual({ 累計入金額: '1', 電話番号2: '03' });
  });

  it('extra が未設定(null)でも動く', () => {
    expect(mergeMemberExtra(null, { 電話番号2: '03' })).toEqual({ 電話番号2: '03' });
  });
});
