/**
 * パスワードの決まりごと(純粋関数)。
 *
 * 画面ごとに最低文字数が違っていた(再設定画面・管理者の設定は 8 文字、プロフィールの変更は 6 文字)ため、
 * 判定をここに集めてそろえる。2026-10-16。
 *   - ログイン画面の再設定画面(/reset-password)
 *   - プロフィール(/account)のパスワード変更
 *   - 管理者によるユーザーのパスワード設定(/settings/users/[id])
 */

/** 最低文字数 */
export const PASSWORD_MIN_LENGTH = 8;
/** 最大文字数(Supabase Auth は bcrypt のため 72 バイトまでしか使われない) */
export const PASSWORD_MAX_LENGTH = 72;

export const PASSWORD_MIN_LENGTH_MESSAGE = `パスワードは${PASSWORD_MIN_LENGTH}文字以上で入力してください`;
export const PASSWORD_MAX_LENGTH_MESSAGE = `パスワードは${PASSWORD_MAX_LENGTH}文字以内で入力してください`;

/** 長さの決まりに合わなければその理由、合えば null */
export function passwordLengthError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return PASSWORD_MIN_LENGTH_MESSAGE;
  if (password.length > PASSWORD_MAX_LENGTH) return PASSWORD_MAX_LENGTH_MESSAGE;
  return null;
}

/** 再設定メールのリンクから戻る画面(新しいパスワードの入力画面) */
export const PASSWORD_RESET_PATH = '/reset-password';

/**
 * 再設定メールのリンクの戻り先 URL。
 * ログイン画面・プロフィールのどちらから送っても同じ画面へ戻す
 * (以前はプロフィールから送ると /login に戻り、新しいパスワードを入力できなかった)。
 * origin の末尾のスラッシュは取り除く。
 */
export function passwordResetRedirectUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}${PASSWORD_RESET_PATH}`;
}
