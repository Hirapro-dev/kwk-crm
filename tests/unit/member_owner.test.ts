/**
 * 会員の新規登録で担当(永久担当 owner_id)をどう決めるか。
 * 意図: 画面で「未設定」を選んだら空のまま登録する(以前は空を「指定なし」と同じに扱い、自分が入っていた)。
 *       担当を送ってこない呼び出し(項目自体が無い)だけ、実行者を担当にする。
 */
import { resolveNewMemberOwner } from '@/lib/domain/member_owner';
import { describe, expect, it } from 'vitest';

const ME = 'u-me';

describe('resolveNewMemberOwner', () => {
  it('担当を選んだときはその人', () => {
    expect(resolveNewMemberOwner('u-other', ME)).toBe('u-other');
  });
  it('「未設定」を選んだとき(null / 空文字 / 空白)は空のまま', () => {
    expect(resolveNewMemberOwner(null, ME)).toBeNull();
    expect(resolveNewMemberOwner('', ME)).toBeNull();
    expect(resolveNewMemberOwner('  ', ME)).toBeNull();
  });
  it('担当の項目自体が無い(undefined)ときは実行者', () => {
    expect(resolveNewMemberOwner(undefined, ME)).toBe(ME);
  });
});
