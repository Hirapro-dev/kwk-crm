'use server';

/**
 * タスク管理(CLAUDE.md §5.20)の Server Actions。
 * 権限は RLS(migration 102)と二重に確認する: 書込は viewer 以外、プロジェクトの設定は作成者と admin、
 * 論理削除は admin(書込みはサービスロール。理由は §8.1 /mail の注記)。
 */

import { getCurrentUser } from '@/lib/domain/auth';
import {
  type MentionUser,
  extractMentionUserIds,
  nextSortOrder,
  storageSafeName,
} from '@/lib/domain/task_pure';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export interface ActionResult<T = undefined> {
  error?: string;
  data?: T;
}

async function requireWriter(): Promise<{ id: string; role: string } | { error: string }> {
  const me = await getCurrentUser();
  if (me.role === 'viewer') return { error: '閲覧専用ユーザーは変更できません' };
  return { id: me.id, role: me.role };
}

const nz = (v: string | null | undefined, max = 500): string | null => {
  const s = (v ?? '').trim();
  return s ? s.slice(0, max) : null;
};
const isDate = (v: string | null) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v);

function revalidateTask(taskId?: number, projectId?: number) {
  revalidatePath('/task');
  revalidatePath('/task/projects');
  if (projectId) revalidatePath(`/task/projects/${projectId}`);
  if (taskId) revalidatePath(`/task/${taskId}`);
}

// ---------------- プロジェクト ----------------

export async function createTaskProject(input: {
  name: string;
  color?: string | null;
  description?: string | null;
  visibility: 'public' | 'private';
  memberIds?: string[];
}): Promise<ActionResult<{ id: number }>> {
  const me = await requireWriter();
  if ('error' in me) return { error: me.error };
  const name = nz(input.name, 200);
  if (!name) return { error: 'プロジェクト名を入力してください' };
  if (input.visibility !== 'public' && input.visibility !== 'private')
    return { error: '公開範囲が不正です' };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('task_projects')
    .insert({
      name,
      color: nz(input.color, 20),
      description: nz(input.description, 2000),
      visibility: input.visibility,
      created_by: me.id,
    })
    .select('id')
    .single();
  if (error) return { error: `プロジェクトの作成に失敗しました: ${error.message}` };
  const id = (data as { id: number }).id;
  // 非公開なら作成者自身を必ずメンバーに入れる(自分が見えなくならないように)
  const members = new Set([...(input.memberIds ?? []), me.id]);
  if (input.visibility === 'private') {
    const rows = [...members].map((user_id) => ({ project_id: id, user_id, added_by: me.id }));
    const { error: mErr } = await supabase.from('task_project_members').insert(rows);
    if (mErr) return { error: `メンバーの登録に失敗しました: ${mErr.message}` };
  }
  revalidateTask(undefined, id);
  return { data: { id } };
}

export async function updateTaskProject(input: {
  id: number;
  name?: string;
  color?: string | null;
  description?: string | null;
  visibility?: 'public' | 'private';
  is_archived?: boolean;
  /** 指定したときはメンバーをこの一覧に置き換える(作成者は常に含める) */
  memberIds?: string[];
}): Promise<ActionResult> {
  const me = await requireWriter();
  if ('error' in me) return { error: me.error };
  const supabase = await createClient();
  const { data: cur } = await supabase
    .from('task_projects')
    .select('id, created_by')
    .eq('id', input.id)
    .maybeSingle();
  if (!cur) return { error: 'プロジェクトが見つかりません' };
  const creator = (cur as { created_by: string | null }).created_by;
  if (me.role !== 'admin' && creator !== me.id)
    return { error: 'プロジェクトの設定は作成者と管理者だけが変更できます' };
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const n = nz(input.name, 200);
    if (!n) return { error: 'プロジェクト名を入力してください' };
    patch.name = n;
  }
  if (input.color !== undefined) patch.color = nz(input.color, 20);
  if (input.description !== undefined) patch.description = nz(input.description, 2000);
  if (input.visibility !== undefined) {
    if (input.visibility !== 'public' && input.visibility !== 'private')
      return { error: '公開範囲が不正です' };
    patch.visibility = input.visibility;
  }
  if (input.is_archived !== undefined) patch.is_archived = input.is_archived;
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from('task_projects').update(patch).eq('id', input.id);
    if (error) return { error: `更新に失敗しました: ${error.message}` };
  }
  if (input.memberIds !== undefined) {
    const members = new Set([...input.memberIds, ...(creator ? [creator] : [])]);
    const { error: dErr } = await supabase
      .from('task_project_members')
      .delete()
      .eq('project_id', input.id);
    if (dErr) return { error: `メンバーの更新に失敗しました: ${dErr.message}` };
    if (members.size > 0) {
      const { error: iErr } = await supabase
        .from('task_project_members')
        .insert(
          [...members].map((user_id) => ({ project_id: input.id, user_id, added_by: me.id })),
        );
      if (iErr) return { error: `メンバーの登録に失敗しました: ${iErr.message}` };
    }
  }
  revalidateTask(undefined, input.id);
  return {};
}

/**
 * プロジェクトを削除する(論理削除。作成者または admin)。中のタスク(サブタスク含む)も論理削除する。
 * 書込みはサービスロール(deleted_at を付けた行は閲覧ポリシーから外れ、PostgREST の RETURNING で拒否されるため)。
 * マイフォルダ内の登録は残るが、一覧に出ないプロジェクトはフォルダの表示からも消える(taskUserFolderSections)。
 */
export async function deleteTaskProject(id: number): Promise<ActionResult> {
  const me = await requireWriter();
  if ('error' in me) return { error: me.error };
  if (!Number.isInteger(id) || id <= 0) return { error: 'プロジェクトが不正です' };
  const supabase = await createClient();
  const { data: cur } = await supabase
    .from('task_projects')
    .select('id, created_by')
    .eq('id', id)
    .maybeSingle();
  if (!cur) return { error: 'プロジェクトが見つかりません' };
  const creator = (cur as { created_by: string | null }).created_by;
  if (me.role !== 'admin' && creator !== me.id)
    return { error: 'プロジェクトの削除は作成者と管理者だけができます' };
  const admin = createServiceRoleClient();
  const now = new Date().toISOString();
  const { error: tErr } = await admin
    .from('tasks')
    .update({ deleted_at: now })
    .eq('project_id', id)
    .is('deleted_at', null);
  if (tErr) return { error: `タスクの削除に失敗しました: ${tErr.message}` };
  const { error } = await admin
    .from('task_projects')
    .update({ deleted_at: now })
    .eq('id', id)
    .is('deleted_at', null);
  if (error) return { error: `削除に失敗しました: ${error.message}` };
  revalidateTask(undefined, id);
  revalidatePath('/task', 'layout');
  return {};
}

// ---------------- セクション ----------------

export async function createTaskSection(
  projectId: number,
  name: string,
): Promise<ActionResult<{ id: number }>> {
  const me = await requireWriter();
  if ('error' in me) return { error: me.error };
  const n = nz(name, 100);
  if (!n) return { error: 'セクション名を入力してください' };
  const supabase = await createClient();
  const { data: last } = await supabase
    .from('task_sections')
    .select('sort_order')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const so = ((last as { sort_order?: number } | null)?.sort_order ?? 0) + 100;
  const { data, error } = await supabase
    .from('task_sections')
    .insert({ project_id: projectId, name: n, sort_order: so })
    .select('id')
    .single();
  if (error) return { error: `セクションの追加に失敗しました: ${error.message}` };
  revalidateTask(undefined, projectId);
  return { data: { id: (data as { id: number }).id } };
}

export async function renameTaskSection(id: number, name: string): Promise<ActionResult> {
  const me = await requireWriter();
  if ('error' in me) return { error: me.error };
  const n = nz(name, 100);
  if (!n) return { error: 'セクション名を入力してください' };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('task_sections')
    .update({ name: n })
    .eq('id', id)
    .select('project_id')
    .maybeSingle();
  if (error) return { error: `名前の変更に失敗しました: ${error.message}` };
  revalidateTask(undefined, (data as { project_id: number } | null)?.project_id);
  return {};
}

/** セクションを削除する(中のタスクは「セクションなし」になる)。作成者・admin のみ */
export async function deleteTaskSection(id: number): Promise<ActionResult> {
  const me = await requireWriter();
  if ('error' in me) return { error: me.error };
  const supabase = await createClient();
  const { data: sec } = await supabase
    .from('task_sections')
    .select('project_id')
    .eq('id', id)
    .maybeSingle();
  if (!sec) return { error: 'セクションが見つかりません' };
  const projectId = (sec as { project_id: number }).project_id;
  const { data: proj } = await supabase
    .from('task_projects')
    .select('created_by')
    .eq('id', projectId)
    .maybeSingle();
  if (me.role !== 'admin' && (proj as { created_by: string | null } | null)?.created_by !== me.id) {
    return { error: 'セクションの削除は作成者と管理者だけができます' };
  }
  const { error } = await supabase.from('task_sections').delete().eq('id', id);
  if (error) return { error: `削除に失敗しました: ${error.message}` };
  revalidateTask(undefined, projectId);
  return {};
}

// ---------------- タスク ----------------

export interface TaskInput {
  name?: string;
  notes?: string | null;
  section_id?: number | null;
  parent_task_id?: number | null;
  assignee_id?: string | null;
  member_id?: string | null;
  start_date?: string | null;
  due_date?: string | null;
}

function validateTaskInput(
  input: TaskInput,
): { patch: Record<string, unknown> } | { error: string } {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const n = nz(input.name, 500);
    if (!n) return { error: 'タスク名を入力してください' };
    patch.name = n;
  }
  if (input.notes !== undefined) patch.notes = (input.notes ?? '').trim() || null;
  if (input.section_id !== undefined) patch.section_id = input.section_id;
  if (input.parent_task_id !== undefined) patch.parent_task_id = input.parent_task_id;
  if (input.assignee_id !== undefined) patch.assignee_id = input.assignee_id || null;
  if (input.member_id !== undefined) patch.member_id = nz(input.member_id, 30);
  if (input.start_date !== undefined) {
    const v = nz(input.start_date, 10);
    if (!isDate(v)) return { error: '開始日の形式が不正です' };
    patch.start_date = v;
  }
  if (input.due_date !== undefined) {
    const v = nz(input.due_date, 10);
    if (!isDate(v)) return { error: '期日の形式が不正です' };
    patch.due_date = v;
  }
  return { patch };
}

export async function createTask(
  projectId: number,
  input: TaskInput & { name: string },
): Promise<ActionResult<{ id: number }>> {
  const me = await requireWriter();
  if ('error' in me) return { error: me.error };
  const v = validateTaskInput(input);
  if ('error' in v) return { error: v.error };
  const supabase = await createClient();
  // 末尾に追加(同じセクション・同じ親の中で最大 + 100)
  let q = supabase
    .from('tasks')
    .select('sort_order')
    .eq('project_id', projectId)
    .is('deleted_at', null);
  q = input.parent_task_id
    ? q.eq('parent_task_id', input.parent_task_id)
    : q.is('parent_task_id', null);
  q = input.section_id ? q.eq('section_id', input.section_id) : q.is('section_id', null);
  const { data: siblings } = await q.order('sort_order', { ascending: false }).limit(1);
  const so = nextSortOrder((siblings ?? []) as Array<{ sort_order: number }>);
  const { data, error } = await supabase
    .from('tasks')
    .insert({ project_id: projectId, ...v.patch, sort_order: so, created_by: me.id })
    .select('id')
    .single();
  if (error) return { error: `タスクの作成に失敗しました: ${error.message}` };
  revalidateTask(input.parent_task_id ?? undefined, projectId);
  return { data: { id: (data as { id: number }).id } };
}

export async function updateTask(id: number, input: TaskInput): Promise<ActionResult> {
  const me = await requireWriter();
  if ('error' in me) return { error: me.error };
  const v = validateTaskInput(input);
  if ('error' in v) return { error: v.error };
  if (Object.keys(v.patch).length === 0) return {};
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('tasks')
    .update(v.patch)
    .eq('id', id)
    .select('project_id')
    .maybeSingle();
  if (error) return { error: `更新に失敗しました: ${error.message}` };
  if (!data) return { error: 'タスクが見つかりません(閲覧できないプロジェクトの可能性)' };
  revalidateTask(id, (data as { project_id: number }).project_id);
  revalidatePath('/members', 'layout');
  return {};
}

export async function setTaskCompleted(id: number, completed: boolean): Promise<ActionResult> {
  const me = await requireWriter();
  if ('error' in me) return { error: me.error };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('tasks')
    .update(
      completed
        ? { completed_at: new Date().toISOString(), completed_by: me.id }
        : { completed_at: null, completed_by: null },
    )
    .eq('id', id)
    .select('project_id, parent_task_id')
    .maybeSingle();
  if (error) return { error: `更新に失敗しました: ${error.message}` };
  const row = data as { project_id: number; parent_task_id: number | null } | null;
  revalidateTask(id, row?.project_id);
  if (row?.parent_task_id) revalidatePath(`/task/${row.parent_task_id}`);
  return {};
}

/** タスクの論理削除(admin のみ。サブタスクも一緒に)。書込みはサービスロール */
export async function deleteTask(id: number): Promise<ActionResult> {
  const me = await getCurrentUser();
  if (me.role !== 'admin') return { error: '削除は管理者のみ可能です' };
  const supabase = await createClient();
  const { data: t } = await supabase
    .from('tasks')
    .select('id, project_id')
    .eq('id', id)
    .maybeSingle();
  if (!t) return { error: 'タスクが見つかりません' };
  const admin = createServiceRoleClient();
  const now = new Date().toISOString();
  const { error } = await admin
    .from('tasks')
    .update({ deleted_at: now })
    .or(`id.eq.${id},parent_task_id.eq.${id}`)
    .is('deleted_at', null);
  if (error) return { error: `削除に失敗しました: ${error.message}` };
  revalidateTask(id, (t as { project_id: number }).project_id);
  return {};
}

// ---------------- コメント ----------------

export async function addTaskComment(
  taskId: number,
  body: string,
): Promise<ActionResult<{ id: number }>> {
  const me = await requireWriter();
  if ('error' in me) return { error: me.error };
  const b = (body ?? '').trim();
  if (!b) return { error: 'コメントを入力してください' };
  if (b.length > 10000) return { error: 'コメントは 10,000 文字以内にしてください' };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('task_comments')
    .insert({ task_id: taskId, user_id: me.id, body: b })
    .select('id')
    .single();
  if (error) return { error: `コメントの投稿に失敗しました: ${error.message}` };
  const commentId = (data as { id: number }).id;

  // メンション(@氏名)。呼ばれた人の行はサービスロールで作る(migration 115)。失敗してもコメント自体は残す
  try {
    const { data: users } = await supabase
      .from('users')
      .select('id, full_name')
      .is('deleted_at', null)
      .eq('is_active', true);
    const mentioned = extractMentionUserIds(b, (users ?? []) as MentionUser[], me.id);
    if (mentioned.length > 0) {
      const admin = createServiceRoleClient();
      await admin.from('task_mentions').insert(
        mentioned.map((user_id) => ({
          comment_id: commentId,
          task_id: taskId,
          user_id,
          created_by: me.id,
        })),
      );
    }
  } catch {
    /* メンションの記録に失敗してもコメントは投稿済み */
  }
  revalidatePath(`/task/${taskId}`);
  revalidatePath('/task', 'layout');
  return { data: { id: commentId } };
}

/** このタスクの自分宛メンションを既読にする(タスク詳細を開いたとき)。RLS で自分の行だけ */
export async function markTaskMentionsRead(taskId: number): Promise<ActionResult> {
  await getCurrentUser();
  if (!Number.isInteger(taskId) || taskId <= 0) return { error: 'タスクが不正です' };
  const supabase = await createClient();
  const { error } = await supabase
    .from('task_mentions')
    .update({ read_at: new Date().toISOString() })
    .eq('task_id', taskId)
    .is('read_at', null);
  if (error) return { error: error.message };
  revalidatePath('/task', 'layout');
  return {};
}

export async function deleteTaskComment(id: number, taskId: number): Promise<ActionResult> {
  const me = await requireWriter();
  if ('error' in me) return { error: me.error };
  const supabase = await createClient();
  const { error } = await supabase.from('task_comments').delete().eq('id', id);
  if (error) return { error: `削除に失敗しました: ${error.message}` };
  revalidatePath(`/task/${taskId}`);
  return {};
}

// ---------------- 添付 ----------------

const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

/** 添付をアップロードする(FormData: taskId, file)。閲覧できるタスクか確認してからサービスロールで保存 */
export async function uploadTaskAttachment(
  formData: FormData,
): Promise<ActionResult<{ id: number }>> {
  const me = await requireWriter();
  if ('error' in me) return { error: me.error };
  const taskId = Number(formData.get('taskId'));
  const file = formData.get('file');
  if (!Number.isInteger(taskId) || taskId <= 0) return { error: 'タスクが不正です' };
  if (!(file instanceof File) || file.size === 0) return { error: 'ファイルを選んでください' };
  if (file.size > ATTACHMENT_MAX_BYTES) return { error: '添付は 25MB 以内にしてください' };
  const supabase = await createClient();
  const { data: t } = await supabase.from('tasks').select('id').eq('id', taskId).maybeSingle();
  if (!t) return { error: 'タスクが見つかりません(閲覧できないプロジェクトの可能性)' };
  // Storage のキーは ASCII しか使えないため変換する。元のファイル名は filename 列に持つ
  const path = `${taskId}/${Date.now()}_${storageSafeName(file.name)}`;
  const admin = createServiceRoleClient();
  const buf = Buffer.from(await file.arrayBuffer());
  const up = await admin.storage
    .from('task-attachments')
    .upload(path, buf, { contentType: file.type || 'application/octet-stream', upsert: false });
  if (up.error) return { error: `アップロードに失敗しました: ${up.error.message}` };
  const { data, error } = await admin
    .from('task_attachments')
    .insert({
      task_id: taskId,
      filename: file.name,
      content_type: file.type || null,
      size_bytes: file.size,
      storage_path: path,
      uploaded_by: me.id,
    })
    .select('id')
    .single();
  if (error) return { error: `添付の登録に失敗しました: ${error.message}` };
  revalidatePath(`/task/${taskId}`);
  return { data: { id: (data as { id: number }).id } };
}

/** 添付の閲覧 URL(短期署名)。閲覧できるタスクの添付だけ発行する */
export async function getTaskAttachmentUrl(
  attachmentId: number,
): Promise<ActionResult<{ url: string }>> {
  await getCurrentUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from('task_attachments')
    .select('storage_path, filename')
    .eq('id', attachmentId)
    .maybeSingle();
  if (!data) return { error: '添付が見つかりません' };
  const row = data as { storage_path: string; filename: string | null };
  const admin = createServiceRoleClient();
  // キーは ASCII 化した名前なので、ダウンロード時は元のファイル名を付ける
  const signed = await admin.storage
    .from('task-attachments')
    .createSignedUrl(row.storage_path, 300, row.filename ? { download: row.filename } : undefined);
  if (signed.error || !signed.data?.signedUrl) return { error: 'URL の発行に失敗しました' };
  return { data: { url: signed.data.signedUrl } };
}

export async function deleteTaskAttachment(id: number, taskId: number): Promise<ActionResult> {
  const me = await requireWriter();
  if ('error' in me) return { error: me.error };
  const supabase = await createClient();
  const { data } = await supabase
    .from('task_attachments')
    .select('storage_path, uploaded_by')
    .eq('id', id)
    .maybeSingle();
  if (!data) return { error: '添付が見つかりません' };
  const row = data as { storage_path: string; uploaded_by: string | null };
  if (me.role !== 'admin' && row.uploaded_by !== me.id)
    return { error: '添付の削除はアップロードした本人と管理者だけができます' };
  const admin = createServiceRoleClient();
  await admin.storage.from('task-attachments').remove([row.storage_path]);
  const { error } = await admin.from('task_attachments').delete().eq('id', id);
  if (error) return { error: `削除に失敗しました: ${error.message}` };
  revalidatePath(`/task/${taskId}`);
  return {};
}
