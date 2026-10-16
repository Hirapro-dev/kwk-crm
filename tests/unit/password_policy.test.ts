import { authRedirectPath } from '@/lib/domain/auth_routes';
import {
  PASSWORD_MIN_LENGTH,
  passwordLengthError,
  passwordResetRedirectUrl,
} from '@/lib/domain/password_policy';
import { describe, expect, it } from 'vitest';

/** パスワードの最低文字数(画面ごとに 6 / 8 文字とずれていたのを 8 文字にそろえた。2026-10-16) */
describe('passwordLengthError', () => {
  it('最低文字数は 8', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
  });
  it('7 文字は不可、8 文字は可(境界)', () => {
    expect(passwordLengthError('1234567')).toMatch(/8文字以上/);
    expect(passwordLengthError('12345678')).toBeNull();
  });
  it('72 文字までは可、73 文字は不可(Supabase Auth が使う上限)', () => {
    expect(passwordLengthError('a'.repeat(72))).toBeNull();
    expect(passwordLengthError('a'.repeat(73))).toMatch(/72文字以内/);
  });
});

/** 再設定メールのリンクの戻り先。ログイン画面・プロフィールのどちらからでも入力画面へ戻す */
describe('passwordResetRedirectUrl', () => {
  it('新しいパスワードの入力画面(/reset-password)を指す', () => {
    expect(passwordResetRedirectUrl('https://crm.hirapro.com')).toBe(
      'https://crm.hirapro.com/reset-password',
    );
  });
  it('末尾のスラッシュがあっても二重にしない', () => {
    expect(passwordResetRedirectUrl('https://crm.hirapro.com/')).toBe(
      'https://crm.hirapro.com/reset-password',
    );
  });
});

/** middleware の転送先 */
describe('authRedirectPath', () => {
  it('未ログインでアプリ画面 → /login', () => {
    expect(authRedirectPath('/members', false)).toBe('/login');
    expect(authRedirectPath('/', false)).toBe('/login');
  });
  it('未ログインでもログイン画面・再設定画面は通す', () => {
    expect(authRedirectPath('/login', false)).toBeNull();
    expect(authRedirectPath('/reset-password', false)).toBeNull();
  });
  it('ログイン済みでログイン画面 → /', () => {
    expect(authRedirectPath('/login', true)).toBe('/');
  });
  it('ログイン済みでも再設定画面は通す(プロフィールから送ったリンクをそのまま開くため)', () => {
    expect(authRedirectPath('/reset-password', true)).toBeNull();
  });
  it('ログイン済みでアプリ画面は通す', () => {
    expect(authRedirectPath('/members', true)).toBeNull();
  });
});
