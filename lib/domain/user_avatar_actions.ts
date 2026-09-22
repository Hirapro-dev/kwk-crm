'use server';

/**
 * プロフィール画像(アイコン)の Server Actions。CLAUDE.md §5.1 / §8.1(migration 114)。
 * 本人だけが自分の画像を設定・削除できる。書込みはサービスロール(users の RLS は変えない)。
 */

import { getCurrentUser } from '@/lib/domain/auth';
import { AVATAR_MAX_BYTES, AVATAR_TYPES, avatarObjectKey } from '@/lib/domain/user_avatar';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export interface AvatarActionResult {
  error?: string;
  avatarPath?: string | null;
}

function revalidate() {
  revalidatePath('/task', 'layout');
  revalidatePath('/', 'layout');
}

/** 画像をアップロードして自分のアイコンにする(FormData: file)。古い画像は消す */
export async function uploadUserAvatar(formData: FormData): Promise<AvatarActionResult> {
  const me = await getCurrentUser();
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: '画像を選んでください' };
  if (!AVATAR_TYPES[file.type]) return { error: 'JPEG / PNG / WebP の画像を選んでください' };
  if (file.size > AVATAR_MAX_BYTES) return { error: '画像は 1MB 以内にしてください' };
  const key = avatarObjectKey(me.id, file.type);
  if (!key) return { error: '画像の種類が不正です' };

  const admin = createServiceRoleClient();
  const buf = Buffer.from(await file.arrayBuffer());
  const up = await admin.storage
    .from('user-avatars')
    .upload(key, buf, { contentType: file.type, upsert: false, cacheControl: '31536000' });
  if (up.error) return { error: `アップロードに失敗しました: ${up.error.message}` };

  const { data: prev } = await admin
    .from('users')
    .select('avatar_path')
    .eq('id', me.id)
    .maybeSingle();
  const { error } = await admin.from('users').update({ avatar_path: key }).eq('id', me.id);
  if (error) return { error: `保存に失敗しました: ${error.message}` };
  const old = (prev as { avatar_path: string | null } | null)?.avatar_path;
  if (old && old !== key) await admin.storage.from('user-avatars').remove([old]);
  revalidate();
  return { avatarPath: key };
}

/** 自分のアイコンを外す(頭文字の表示に戻す) */
export async function removeUserAvatar(): Promise<AvatarActionResult> {
  const me = await getCurrentUser();
  const admin = createServiceRoleClient();
  const { data: prev } = await admin
    .from('users')
    .select('avatar_path')
    .eq('id', me.id)
    .maybeSingle();
  const { error } = await admin.from('users').update({ avatar_path: null }).eq('id', me.id);
  if (error) return { error: `削除に失敗しました: ${error.message}` };
  const old = (prev as { avatar_path: string | null } | null)?.avatar_path;
  if (old) await admin.storage.from('user-avatars').remove([old]);
  revalidate();
  return { avatarPath: null };
}
