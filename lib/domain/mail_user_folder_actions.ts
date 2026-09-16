'use server';

/**
 * マイフォルダ(ユーザーごとの受信箱フォルダ)の Server Actions。CLAUDE.md §5.15 / migration 92。
 * メーラー左フォルダの「マイフォルダ」区画(作成・名前変更・削除・受信箱のドラッグ&ドロップ)から呼ぶ。
 * 行は実行ユーザー自身のものだけ(RLS: user_id = auth.uid())で、ここでも user_id を自分の ID にして二重に確認する。
 */

import { getCurrentUser } from '@/lib/domain/auth';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { moveBoxInList } from './mail_folders';

export interface MailUserFolderActionResult {
  error?: string;
  id?: number;
}

const MAX_NAME = 50;

function validId(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}

function revalidate() {
  revalidatePath('/mail', 'layout');
}

export async function createMailUserFolder(name: string): Promise<MailUserFolderActionResult> {
  const trimmed = (name ?? '').trim().slice(0, MAX_NAME);
  if (!trimmed) return { error: 'フォルダ名を入力してください' };
  const me = await getCurrentUser();
  const supabase = await createClient();
  // 並びは作成順(既存の最大 sort_order + 10)
  const { data: last } = await supabase
    .from('mail_user_folders')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = Number((last as { sort_order?: number } | null)?.sort_order ?? 0) + 10;
  const { data, error } = await supabase
    .from('mail_user_folders')
    .insert({ user_id: me.id, name: trimmed, sort_order: sortOrder })
    .select('id')
    .single();
  if (error) return { error: `フォルダの作成に失敗しました: ${error.message}` };
  revalidate();
  return { id: Number((data as { id: number }).id) };
}

export async function renameMailUserFolder(
  folderId: number,
  name: string,
): Promise<MailUserFolderActionResult> {
  if (!validId(folderId)) return { error: 'フォルダの指定が不正です' };
  const trimmed = (name ?? '').trim().slice(0, MAX_NAME);
  if (!trimmed) return { error: 'フォルダ名を入力してください' };
  const me = await getCurrentUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from('mail_user_folders')
    .update({ name: trimmed })
    .eq('id', folderId)
    .eq('user_id', me.id);
  if (error) return { error: `名前の変更に失敗しました: ${error.message}` };
  revalidate();
  return { id: folderId };
}

export async function deleteMailUserFolder(folderId: number): Promise<MailUserFolderActionResult> {
  if (!validId(folderId)) return { error: 'フォルダの指定が不正です' };
  const me = await getCurrentUser();
  const supabase = await createClient();
  // 中の受信箱の登録は ON DELETE CASCADE で消える(受信箱そのものは消えない)
  const { error } = await supabase
    .from('mail_user_folders')
    .delete()
    .eq('id', folderId)
    .eq('user_id', me.id);
  if (error) return { error: `フォルダの削除に失敗しました: ${error.message}` };
  revalidate();
  return { id: folderId };
}

/**
 * 受信箱をフォルダに入れる(ドロップ)。
 * - beforeBoxId を指定するとその受信箱の前に差し込む(フォルダ内の並び替え)。null なら末尾
 * - fromFolderId を指定すると、そのフォルダからは外す(フォルダ間の移動)。同じフォルダなら並び替えだけ
 */
export async function placeMailBoxInFolder(input: {
  folderId: number;
  mailBoxId: number;
  beforeBoxId?: number | null;
  fromFolderId?: number | null;
}): Promise<MailUserFolderActionResult> {
  const { folderId, mailBoxId } = input;
  if (!validId(folderId) || !validId(mailBoxId)) return { error: '指定が不正です' };
  const me = await getCurrentUser();
  const supabase = await createClient();

  // 自分のフォルダか(RLS でも守られるが、明示的に確認して分かりやすいエラーにする)
  const { data: folder } = await supabase
    .from('mail_user_folders')
    .select('id')
    .eq('id', folderId)
    .eq('user_id', me.id)
    .maybeSingle();
  if (!folder) return { error: 'フォルダが見つかりません' };

  const { data: current, error: cErr } = await supabase
    .from('mail_user_folder_items')
    .select('mail_box_id')
    .eq('folder_id', folderId)
    .eq('user_id', me.id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (cErr) return { error: `取得に失敗しました: ${cErr.message}` };
  const ids = ((current ?? []) as Array<{ mail_box_id: number }>).map((r) => Number(r.mail_box_id));
  const next = moveBoxInList(ids, mailBoxId, input.beforeBoxId ?? null);

  // 並びを振り直して upsert(新規の受信箱はここで追加される)
  const rows = next.map((id, i) => ({
    folder_id: folderId,
    mail_box_id: id,
    user_id: me.id,
    sort_order: (i + 1) * 10,
  }));
  const { error: uErr } = await supabase
    .from('mail_user_folder_items')
    .upsert(rows, { onConflict: 'folder_id,mail_box_id' });
  if (uErr) return { error: `フォルダへの追加に失敗しました: ${uErr.message}` };

  // 別フォルダからの移動なら、元のフォルダから外す
  const from = input.fromFolderId ?? null;
  if (from !== null && validId(from) && from !== folderId) {
    await supabase
      .from('mail_user_folder_items')
      .delete()
      .eq('folder_id', from)
      .eq('mail_box_id', mailBoxId)
      .eq('user_id', me.id);
  }
  revalidate();
  return { id: folderId };
}

export async function removeMailBoxFromFolder(
  folderId: number,
  mailBoxId: number,
): Promise<MailUserFolderActionResult> {
  if (!validId(folderId) || !validId(mailBoxId)) return { error: '指定が不正です' };
  const me = await getCurrentUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from('mail_user_folder_items')
    .delete()
    .eq('folder_id', folderId)
    .eq('mail_box_id', mailBoxId)
    .eq('user_id', me.id);
  if (error) return { error: `フォルダから外せませんでした: ${error.message}` };
  revalidate();
  return { id: folderId };
}
