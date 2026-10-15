'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from './auth';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MAX_LENGTH_MESSAGE,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MIN_LENGTH_MESSAGE,
  passwordResetRedirectUrl,
} from './password_policy';

/**
 * 自分自身のプロフィール編集 Server Actions。
 *
 * 仕様(過去会話で確定):
 *   - 名前変更: 管理者のみ可 (sales/manager/viewer は閲覧のみ)
 *   - メアド変更: 自分自身可、Supabase Auth に変更要求(確認メール送信)
 *   - パスワード変更: 現在PW再認証 → 新PW設定
 *   - パスワードリセット: メールリンクで再設定
 *
 * 全 Action は getCurrentUser() で本人認証済を前提に動作する。
 * Supabase Auth が無効(devAuth モード等)の場合はエラーを返す。
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

// ----------------------------------------------------------------------------
// 名前変更 (admin のみ可)
// ----------------------------------------------------------------------------

const UpdateNameSchema = z.object({
  last_name: z.string().min(1).max(100),
  first_name: z.string().max(100).optional().or(z.literal('').transform(() => undefined)),
});

export async function updateMyName(input: {
  last_name: string;
  first_name?: string;
}): Promise<ActionResult> {
  const parsed = UpdateNameSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '入力エラー' };
  }
  const me = await getCurrentUser();
  if (me.role !== 'admin') {
    return { ok: false, error: '名前変更は管理者のみ可能です' };
  }

  const last_name = parsed.data.last_name.trim();
  const first_name = parsed.data.first_name?.trim() || null;
  const full_name = first_name ? `${last_name} ${first_name}` : last_name;

  const supabase = await createClient();
  const { error } = await supabase
    .from('users')
    .update({ last_name, first_name, full_name })
    .eq('id', me.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/account');
  return { ok: true, message: '氏名を更新しました' };
}

// ----------------------------------------------------------------------------
// メールアドレス変更 (自分自身、確認メール送信)
// ----------------------------------------------------------------------------

const UpdateEmailSchema = z.object({
  email: z.string().email('メールアドレスの形式が正しくありません'),
});

export async function updateMyEmail(input: { email: string }): Promise<ActionResult> {
  const parsed = UpdateEmailSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '入力エラー' };
  }
  await getCurrentUser(); // 認証チェック

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ email: parsed.data.email });
  if (error) {
    return {
      ok: false,
      error: `メアド変更に失敗: ${error.message}`,
    };
  }

  return {
    ok: true,
    message: '確認メールを送信しました。新しいメールアドレスのリンクをクリックして変更を完了してください。',
  };
}

// ----------------------------------------------------------------------------
// パスワード変更 (現在PW再認証 → 新PW)
// ----------------------------------------------------------------------------

const UpdatePasswordSchema = z
  .object({
    current_password: z.string().min(1, '現在のパスワードを入力してください'),
    new_password: z
      .string()
      .min(PASSWORD_MIN_LENGTH, PASSWORD_MIN_LENGTH_MESSAGE)
      .max(PASSWORD_MAX_LENGTH, PASSWORD_MAX_LENGTH_MESSAGE),
    confirm_password: z.string(),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    path: ['confirm_password'],
    message: '確認用パスワードが一致しません',
  });

export async function updateMyPassword(input: {
  current_password: string;
  new_password: string;
  confirm_password: string;
}): Promise<ActionResult> {
  const parsed = UpdatePasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '入力エラー' };
  }
  const me = await getCurrentUser();

  const supabase = await createClient();

  // 1) 現在のパスワードで再認証
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: me.email,
    password: parsed.data.current_password,
  });
  if (signInError) {
    return {
      ok: false,
      error: '現在のパスワードが正しくありません',
    };
  }

  // 2) 新しいパスワードに変更
  const { error: updateError } = await supabase.auth.updateUser({
    password: parsed.data.new_password,
  });
  if (updateError) {
    return { ok: false, error: `パスワード変更に失敗: ${updateError.message}` };
  }

  return { ok: true, message: 'パスワードを変更しました' };
}

// ----------------------------------------------------------------------------
// パスワードリセット (メールリンク送信)
// ----------------------------------------------------------------------------

export async function sendMyPasswordResetEmail(): Promise<ActionResult> {
  const me = await getCurrentUser();

  const supabase = await createClient();

  // リンクの戻り先はログイン画面からの再設定と同じ「新しいパスワードの入力画面」(/reset-password)。
  // 以前は /login に戻していたため、リンクを開いても新しいパスワードを入力できなかった(2026-10-16 修正)。
  // サイトの URL は NEXT_PUBLIC_SITE_URL、無ければこのリクエストの送信元(Origin)。
  // どちらも無ければ redirectTo を付けず、Supabase Auth の Site URL に任せる。
  const origin = process.env.NEXT_PUBLIC_SITE_URL || (await headers()).get('origin');
  const { error } = await supabase.auth.resetPasswordForEmail(
    me.email,
    origin ? { redirectTo: passwordResetRedirectUrl(origin) } : undefined,
  );
  if (error) {
    return { ok: false, error: `リセットメール送信に失敗: ${error.message}` };
  }

  return {
    ok: true,
    message: `${me.email} にパスワードリセット用のメールを送信しました`,
  };
}
