'use server';

import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCurrentUser } from './auth';

const ROLES = ['admin', 'manager', 'sales', 'viewer', 'support'] as const;

const UpdateRoleSchema = z.object({
  user_id: z.string().uuid(),
  role: z.enum(ROLES),
  is_active: z.boolean().optional(),
});

export interface UserUpdateResult {
  ok: boolean;
  error?: string;
}

export async function updateUserRole(input: {
  user_id: string;
  role: string;
  is_active?: boolean;
}): Promise<UserUpdateResult> {
  const parsed = UpdateRoleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '入力エラー' };
  }
  const me = await getCurrentUser();
  if (me.role !== 'admin') {
    return { ok: false, error: 'ユーザー管理は admin のみ可能です' };
  }
  if (parsed.data.user_id === me.id && parsed.data.role !== 'admin') {
    return { ok: false, error: '自分自身を非 admin に降格することはできません' };
  }

  // 管理者操作は RLS(is_admin)に依存せずサービスロールで実行(アプリ側で admin 確認済み)
  const supabase = createServiceRoleClient();
  const update: Record<string, unknown> = { role: parsed.data.role };
  if (parsed.data.is_active !== undefined) update.is_active = parsed.data.is_active;

  const { error } = await supabase.from('users').update(update).eq('id', parsed.data.user_id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/users');
  revalidatePath('/settings/users');
  return { ok: true };
}

// ----------------------------------------------------------------------------
// 削除 (論理削除: deleted_at をセット。物理削除は禁止 — 仕様書 §4.3)
// ----------------------------------------------------------------------------

const DeleteSchema = z.object({ user_id: z.string().uuid() });

export async function deleteUser(input: { user_id: string }): Promise<UserUpdateResult> {
  const parsed = DeleteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '入力エラー' };
  }
  const me = await getCurrentUser();
  if (me.role !== 'admin') {
    return { ok: false, error: 'ユーザー管理は admin のみ可能です' };
  }
  if (parsed.data.user_id === me.id) {
    return { ok: false, error: '自分自身は削除できません' };
  }

  // 管理者操作は RLS(is_admin)に依存せずサービスロールで実行(アプリ側で admin 確認済み)
  const supabase = createServiceRoleClient();
  // 論理削除: deleted_at をセットし、無効化もしておく。
  // members/activities 等の owner_id 参照はそのまま残るため FK は壊れない。
  const { error } = await supabase
    .from('users')
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq('id', parsed.data.user_id)
    .is('deleted_at', null);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/users');
  revalidatePath('/settings/users');
  return { ok: true };
}

// ----------------------------------------------------------------------------
// ログインパスワード設定 (admin が直接決める)
// ----------------------------------------------------------------------------

const PasswordSchema = z.object({
  user_id: z.string().uuid(),
  password: z
    .string()
    .min(8, 'パスワードは8文字以上にしてください')
    .max(72, 'パスワードが長すぎます'),
});

/**
 * 対象ユーザーのログインパスワードを設定する (admin限定)。
 * Supabase Auth の updateUserById を service role で呼ぶ。
 * 注: CSV取込ユーザー等、まだログインアカウント(auth.users)が無い場合は
 *     更新できないため、その旨を返す(先に招待が必要)。
 */
export async function setUserPassword(input: {
  user_id: string;
  password: string;
}): Promise<UserUpdateResult> {
  const parsed = PasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '入力エラー' };
  }
  const me = await getCurrentUser();
  if (me.role !== 'admin') {
    return { ok: false, error: 'ユーザー管理は admin のみ可能です' };
  }

  const admin = createServiceRoleClient();
  const { error } = await admin.auth.admin.updateUserById(parsed.data.user_id, {
    password: parsed.data.password,
  });
  if (error) {
    return {
      ok: false,
      error: `パスワード設定に失敗しました: ${error.message} (このユーザーにログインアカウントが無い場合は、先に「招待」してください)`,
    };
  }
  return { ok: true };
}

// ----------------------------------------------------------------------------
// 招待 (新規ユーザーをメールで招待)
// ----------------------------------------------------------------------------

const InviteSchema = z.object({
  email: z.string().email('メールアドレスの形式が正しくありません'),
  last_name: z.string().min(1, '姓を入力してください').max(100),
  first_name: z
    .string()
    .max(100)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  role: z.enum(ROLES).default('sales'),
});

export interface InviteResult {
  ok: boolean;
  error?: string;
  message?: string;
  user_id?: string;
}

/**
 * 新規ユーザーを招待する (管理者のみ)。
 *
 * Supabase Admin API の inviteUserByEmail() でメール招待。
 * 招待リンクから新規パスワード設定するとログイン可能になる。
 * 招待と同時に public.users 行を upsert し、姓名・ロールを設定。
 */
export async function inviteUser(input: {
  email: string;
  last_name: string;
  first_name?: string;
  role?: 'admin' | 'manager' | 'sales' | 'viewer' | 'support';
}): Promise<InviteResult> {
  const parsed = InviteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '入力エラー' };
  }
  const me = await getCurrentUser();
  if (me.role !== 'admin') {
    return { ok: false, error: '招待は admin のみ可能です' };
  }

  const supabase = await createClient();

  // 既に同メアドの public.users が居ないかチェック
  const { data: existing, error: chkErr } = await supabase
    .from('users')
    .select('id, email')
    .eq('email', parsed.data.email)
    .is('deleted_at', null)
    .maybeSingle();
  if (chkErr) return { ok: false, error: chkErr.message };
  if (existing) {
    return { ok: false, error: '同じメールアドレスのユーザーが既に登録されています' };
  }

  // Supabase Auth に招待
  const { data: authData, error: authErr } = await supabase.auth.admin.inviteUserByEmail(
    parsed.data.email,
    {
      data: {
        last_name: parsed.data.last_name,
        first_name: parsed.data.first_name ?? null,
      },
    },
  );
  if (authErr || !authData?.user) {
    return { ok: false, error: authErr?.message ?? '招待に失敗しました' };
  }

  const authUserId = authData.user.id;
  const last_name = parsed.data.last_name.trim();
  const first_name = parsed.data.first_name?.trim() || null;
  const full_name = first_name ? `${last_name} ${first_name}` : last_name;

  // public.users を upsert
  const { error: upsertErr } = await supabase.from('users').upsert(
    {
      id: authUserId,
      email: parsed.data.email,
      last_name,
      first_name,
      full_name,
      role: parsed.data.role,
      is_active: true,
      legacy_sf_id: null,
    },
    { onConflict: 'id' },
  );

  if (upsertErr) {
    // auth は残しておくとゴミになるので削除
    await supabase.auth.admin.deleteUser(authUserId);
    return { ok: false, error: `public.users upsert失敗: ${upsertErr.message}` };
  }

  revalidatePath('/admin/users');
  revalidatePath('/settings/users');

  return {
    ok: true,
    user_id: authUserId,
    message: `${parsed.data.email} に招待メールを送信しました`,
  };
}
