import { describe, expect, it } from 'vitest';
import { GENDER_OPTIONS, genderLabel } from '../../lib/domain/member_gender';

/**
 * 会員の性別の選択肢(CLAUDE.md §5.4)。保存値は既存データと CSV 取込に合わせた「男 / 女」のまま、
 * 表示だけ「男性 / 女性」にする。
 */
describe('GENDER_OPTIONS / genderLabel', () => {
  it('選択肢は 男性・女性・法人・その他 の4つで、保存値は既存データと同じ 男 / 女 / 法人 / その他', () => {
    expect(GENDER_OPTIONS.map((o) => o.label)).toEqual(['男性', '女性', '法人', 'その他']);
    expect(GENDER_OPTIONS.map((o) => o.value)).toEqual(['男', '女', '法人', 'その他']);
  });
  it('表示名は保存値から引き、選択肢に無い値や空はそのまま', () => {
    expect(genderLabel('男')).toBe('男性');
    expect(genderLabel('法人')).toBe('法人');
    expect(genderLabel('不明')).toBe('不明');
    expect(genderLabel(null)).toBe('');
  });
});
