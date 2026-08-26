import { describe, expect, it } from 'vitest';
import { buildMemberSearchOr } from '../../lib/domain/members';

/**
 * 会員のあいまい検索(q)の or 句組み立て。
 * ヘッダー検索 / 全体検索(/search) / 会員一覧 が共有するため、
 * ここが壊れると3画面すべての検索が同時に壊れる。
 */
describe('buildMemberSearchOr(仕様書 §8.1 ヘッダー検索)', () => {
  it('空文字・空白のみは null を返す(or 句を付けない)', () => {
    expect(buildMemberSearchOr('')).toBeNull();
    expect(buildMemberSearchOr('   ')).toBeNull();
  });

  it('従来の5フィールドは部分一致(%q%)のまま', () => {
    const or = buildMemberSearchOr('田中');
    expect(or).toContain('name.ilike.%田中%');
    expect(or).toContain('name_kana.ilike.%田中%');
    expect(or).toContain('email1.ilike.%田中%');
    expect(or).toContain('phone1.ilike.%田中%');
    expect(or).toContain('id.ilike.%田中%');
  });

  /**
   * 都道府県を部分一致にすると「京都」で「東京都」を拾ってしまう。
   * 本番データで 京都府468件 に対し 東京都3,480件 が混入するため前方一致にしている。
   */
  it('都道府県は前方一致(q%)であり、部分一致(%q%)にはしない', () => {
    const or = buildMemberSearchOr('京都');
    expect(or).toContain('prefecture.ilike.京都%');
    expect(or).not.toContain('prefecture.ilike.%京都%');
  });

  it('途中までの入力でも都道府県を絞れる', () => {
    expect(buildMemberSearchOr('東京')).toContain('prefecture.ilike.東京%');
    expect(buildMemberSearchOr('神奈川')).toContain('prefecture.ilike.神奈川%');
    expect(buildMemberSearchOr('北海')).toContain('prefecture.ilike.北海%');
  });

  /**
   * 1文字だと「東」で東京都3,480件が返り、氏名検索の結果が埋もれてしまう。
   * 都道府県名は2文字あれば絞れるので、1文字のときだけ対象外にする。
   */
  it('1文字のときは都道府県を検索対象にしない', () => {
    const one = buildMemberSearchOr('東');
    expect(one).not.toContain('prefecture');
    // 他フィールドの検索は1文字でも従来どおり効く
    expect(one).toContain('name.ilike.%東%');

    expect(buildMemberSearchOr('東京')).toContain('prefecture');
  });

  it('LIKE のメタ文字をエスケープする(ワイルドカードとして働かせない)', () => {
    const or = buildMemberSearchOr('100%');
    expect(or).toContain('name.ilike.%100\\%%');
    // エスケープでの文字数増加が1文字判定に影響しないこと(生の入力長で判定する)
    expect(buildMemberSearchOr('%')).not.toContain('prefecture');
  });
});
