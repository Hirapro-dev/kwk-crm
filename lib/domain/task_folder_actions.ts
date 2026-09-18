'use server';

/**
 * タスク管理のマイフォルダ(ユーザーごとのプロジェクトフォルダ)の Server Actions。CLAUDE.md §5.20 / migration 110。
 * 左メニューの「マイフォルダ」区画(作成・名前変更・削除・プロジェクトのドラッグ&ドロップ)から呼ぶ。
 * 行は実行ユーザー自身のものだけ(RLS: user_id = auth.uid())で、ここでも user_id を自分の ID にして二重に確認する。
 * メーラーの mail_user_folder_actions.ts と同じ作り(並びの計算は同じ純粋関数 moveBoxInList)。
 */

import { getCurrentUser } from '@/lib/domain/auth';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { moveBoxInList } from './mail_folders';

export interface TaskUserFolderActionResult {
  error?: string;
  id?: number;
}

const MAX_NAME = 50;

function validId(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}

function revalidate() {
  revalidatePath('/task', 'layout');
}

export async function createTaskUserFolder(name: string): Promise<TaskUserFolderActionResult> {
  const trimmed = (name ?? '').trim().slice(0, MAX_NAME);
  if (!trimmed) return { error: 'フォルダ名を入力してください' };
  const me = await getCurrentUser();
  const supabase = await createClient();
  const { data: last } = await supabase
    .from('task_user_folders')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = Number((last as { sort_order?: number } | null)?.sort_order ?? 0) + 10;
  const { data, error } = await supabase
    .from('task_user_folders')
    .insert({ user_id: me.id, name: trimmed, sort_order: sortOrder })
    .select('id')
    .single();
  if (error) return { error: `フォルダの作成に失敗しました: ${error.message}` };
  revalidate();
  return { id: Number((data as { id: number }).id) };
}

export async function renameTaskUserFolder(
  folderId: number,
  name: string,
): Promise<TaskUserFolderActionResult> {
  if (!validId(folderId)) return { error: 'フォルダの指定が不正です' };
  const trimmed = (name ?? '').trim().slice(0, MAX_NAME);
  if (!trimmed) return { error: 'フォルダ名を入力してください' };
  const me = await getCurrentUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from('task_user_folders')
    .update({ name: trimmed })
    .eq('id', folderId)
    .eq('user_id', me.id);
  if (error) return { error: `名前の変更に失敗しました: ${error.message}` };
  revalidate();
  return { id: folderId };
}

export async function deleteTaskUserFolder(folderId: number): Promise<TaskUserFolderActionResult> {
  if (!validId(folderId)) return { error: 'フォルダの指定が不正です' };
  const me = await getCurrentUser();
  const supabase = await createClient();
  // 中のプロジェクトの登録は ON DELETE CASCADE で消える(プロジェクトそのものは消えない)
  const { error } = await supabase
    .from('task_user_folders')
    .delete()
    .eq('id', folderId)
    .eq('user_id', me.id);
  if (error) return { error: `フォルダの削除に失敗しました: ${error.message}` };
  revalidate();
  return { id: folderId };
}

/**
 * プロジェクトをフォルダに入れる(ドロップ)。
 * - beforeProjectId を指定するとそのプロジェクトの前に差し込む(フォルダ内の並び替え)。null なら末尾
 * - fromFolderId を指定すると、そのフォルダからは外す(フォルダ間の移動)。同じフォルダなら並び替えだけ
 */
export async function placeTaskProjectInFolder(input: {
  folderId: number;
  projectId: number;
  beforeProjectId?: number | null;
  fromFolderId?: number | null;
}): Promise<TaskUserFolderActionResult> {
  const { folderId, projectId } = input;
  if (!validId(folderId) || !validId(projectId)) return { error: '指定が不正です' };
  const me = await getCurrentUser();
  const supabase = await createClient();

  const { data: folder } = await supabase
    .from('task_user_folders')
    .select('id')
    .eq('id', folderId)
    .eq('user_id', me.id)
    .maybeSingle();
  if (!folder) return { error: 'フォルダが見つかりません' };
  // 閲覧できるプロジェクトだけ(RLS で見えないものは入れられない)
  const { data: project } = await supabase
    .from('task_projects')
    .select('id')
    .eq('id', projectId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!project) return { error: 'プロジェクトが見つかりません' };

  const { data: current, error: cErr } = await supabase
    .from('task_user_folder_items')
    .select('project_id')
    .eq('folder_id', folderId)
    .eq('user_id', me.id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (cErr) return { error: `取得に失敗しました: ${cErr.message}` };
  const ids = ((current ?? []) as Array<{ project_id: number }>).map((r) => Number(r.project_id));
  const next = moveBoxInList(ids, projectId, input.beforeProjectId ?? null);

  const rows = next.map((id, i) => ({
    folder_id: folderId,
    project_id: id,
    user_id: me.id,
    sort_order: (i + 1) * 10,
  }));
  const { error: uErr } = await supabase
    .from('task_user_folder_items')
    .upsert(rows, { onConflict: 'folder_id,project_id' });
  if (uErr) return { error: `フォルダへの追加に失敗しました: ${uErr.message}` };

  const from = input.fromFolderId ?? null;
  if (from !== null && validId(from) && from !== folderId) {
    await supabase
      .from('task_user_folder_items')
      .delete()
      .eq('folder_id', from)
      .eq('project_id', projectId)
      .eq('user_id', me.id);
  }
  revalidate();
  return { id: folderId };
}

export async function removeTaskProjectFromFolder(
  folderId: number,
  projectId: number,
): Promise<TaskUserFolderActionResult> {
  if (!validId(folderId) || !validId(projectId)) return { error: '指定が不正です' };
  const me = await getCurrentUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from('task_user_folder_items')
    .delete()
    .eq('folder_id', folderId)
    .eq('project_id', projectId)
    .eq('user_id', me.id);
  if (error) return { error: `フォルダから外せませんでした: ${error.message}` };
  revalidate();
  return { id: folderId };
}
