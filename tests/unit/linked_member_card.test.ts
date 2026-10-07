import { joinContacts } from '@/components/members/LinkedMemberCard';
import { describe, expect, it } from 'vitest';

/**
 * 問合せ・申込の詳細の「会員情報」カードの電話・メール(2026-10-07)。
 * 意図: 会員の 2 つ目以降の電話・メールも出す。空や同じ値の重複は出さない。
 */
describe('joinContacts', () => {
  it('空を除いて改行でつなぎ、同じ値は 1 つにする', () => {
    expect(joinContacts(['09000000000', null, ' 08000000000 ', '09000000000'])).toBe(
      '09000000000\n08000000000',
    );
  });
  it('全部空なら空文字', () => {
    expect(joinContacts([null, undefined, ''])).toBe('');
  });
});
