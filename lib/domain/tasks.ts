/**
 * タスク管理(CLAUDE.md §5.20)の読み取り。RLS(can_view_task_project)で閲覧範囲が絞られる。
 * 更新は task_actions.ts。表示ロジックは task_pure.ts。
 */

import { createClient } from '@/lib/supabase/server';

export interface TaskProject {
  id: number;
  name: string;
  color: string | null;
  description: string | null;
  visibility: 'public' | 'private';
  is_archived: boolean;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  /** 一覧用: 未完了タスク数 */
  open_count?: number;
}

export interface TaskSection {
  id: number;
  project_id: number;
  name: string;
  sort_order: number;
}

export interface TaskRow {
  id: number;
  project_id: number;
  section_id: number | null;
  parent_task_id: number | null;
  name: string;
  notes: string | null;
  assignee_id: string | null;
  assignee_name_raw: string | null;
  member_id: string | null;
  start_date: string | null;
  due_date: string | null;
  completed_at: string | null;
  created_by: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  assignee?: { id: string; full_name: string | null; avatar_path?: string | null } | null;
  member?: { id: string; name: string | null } | null;
  project?: { id: number; name: string; color: string | null } | null;
  section?: { id: number; name: string } | null;
  /** 一覧用: サブタスク数 / コメント数 */
  subtask_count?: number;
  comment_count?: number;
}

export interface TaskComment {
  id: number;
  task_id: number;
  user_id: string | null;
  author_name_raw: string | null;
  body: string;
  created_at: string;
  user?: { id: string; full_name: string | null; avatar_path?: string | null } | null;
}

export interface TaskAttachment {
  id: number;
  task_id: number;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
  storage_path: string;
  uploaded_by: string | null;
  created_at: string;
}

const TASK_COLS = `
  id, project_id, section_id, parent_task_id, name, notes, assignee_id, assignee_name_raw, member_id,
  start_date, due_date, completed_at, created_by, sort_order, created_at, updated_at,
  assignee:users!tasks_assignee_id_fkey(id, full_name, avatar_path),
  member:members!tasks_member_id_fkey(id, name),
  project:task_projects!tasks_project_id_fkey(id, name, color),
  section:task_sections!tasks_section_id_fkey(id, name)
`;

/** プロジェクト一覧(閲覧できるものだけ)。未完了タスク数つき */
export async function listTaskProjects(
  opts: { includeArchived?: boolean } = {},
): Promise<TaskProject[]> {
  const supabase = await createClient();
  let q = supabase
    .from('task_projects')
    .select(
      'id, name, color, description, visibility, is_archived, sort_order, created_by, created_at',
    )
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (!opts.includeArchived) q = q.eq('is_archived', false);
  const { data, error } = await q;
  if (error) return []; // migration 102 未適用でも画面を壊さない
  const projects = (data ?? []) as TaskProject[];
  if (projects.length === 0) return projects;
  // 未完了タスク数(親タスクのみ数える)
  const { data: open } = await supabase
    .from('tasks')
    .select('project_id')
    .in(
      'project_id',
      projects.map((p) => p.id),
    )
    .is('deleted_at', null)
    .is('completed_at', null)
    .is('parent_task_id', null)
    .limit(10000);
  const counts = new Map<number, number>();
  for (const r of (open ?? []) as Array<{ project_id: number }>) {
    counts.set(r.project_id, (counts.get(r.project_id) ?? 0) + 1);
  }
  return projects.map((p) => ({ ...p, open_count: counts.get(p.id) ?? 0 }));
}

export async function getTaskProject(id: number): Promise<TaskProject | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('task_projects')
    .select(
      'id, name, color, description, visibility, is_archived, sort_order, created_by, created_at',
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  return (data as TaskProject | null) ?? null;
}

export async function listTaskProjectMembers(
  projectId: number,
): Promise<Array<{ user_id: string; full_name: string | null; email: string }>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('task_project_members')
    .select('user_id, user:users!task_project_members_user_id_fkey(full_name, email)')
    .eq('project_id', projectId);
  return (
    (data ?? []) as unknown as Array<{
      user_id: string;
      user: { full_name: string | null; email: string } | null;
    }>
  ).map((r) => ({
    user_id: r.user_id,
    full_name: r.user?.full_name ?? null,
    email: r.user?.email ?? '',
  }));
}

export async function listTaskSections(projectId: number): Promise<TaskSection[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('task_sections')
    .select('id, project_id, name, sort_order')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });
  return (data ?? []) as TaskSection[];
}

/** サブタスク数・コメント数を付ける(一覧用) */
async function attachCounts(rows: TaskRow[]): Promise<TaskRow[]> {
  if (rows.length === 0) return rows;
  const supabase = await createClient();
  const ids = rows.map((r) => r.id);
  const [subs, comments] = await Promise.all([
    supabase
      .from('tasks')
      .select('parent_task_id')
      .in('parent_task_id', ids)
      .is('deleted_at', null)
      .limit(10000),
    supabase.from('task_comments').select('task_id').in('task_id', ids).limit(10000),
  ]);
  const sc = new Map<number, number>();
  for (const r of (subs.data ?? []) as Array<{ parent_task_id: number }>)
    sc.set(r.parent_task_id, (sc.get(r.parent_task_id) ?? 0) + 1);
  const cc = new Map<number, number>();
  for (const r of (comments.data ?? []) as Array<{ task_id: number }>)
    cc.set(r.task_id, (cc.get(r.task_id) ?? 0) + 1);
  return rows.map((r) => ({
    ...r,
    subtask_count: sc.get(r.id) ?? 0,
    comment_count: cc.get(r.id) ?? 0,
  }));
}

/** プロジェクトのタスク(親タスクのみ。サブタスクは詳細で見る)。完了済みは includeCompleted のときだけ */
export async function listProjectTasks(
  projectId: number,
  opts: { includeCompleted?: boolean } = {},
): Promise<TaskRow[]> {
  const supabase = await createClient();
  let q = supabase
    .from('tasks')
    .select(TASK_COLS)
    .eq('project_id', projectId)
    .is('parent_task_id', null)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true })
    .limit(5000);
  if (!opts.includeCompleted) q = q.is('completed_at', null);
  const { data, error } = await q;
  if (error) return [];
  return attachCounts((data ?? []) as unknown as TaskRow[]);
}

/** マイタスク: 自分が担当のタスク(サブタスクも含む)。完了済みは includeCompleted のときだけ(直近 200 件) */
export async function listMyTasks(
  userId: string,
  opts: { includeCompleted?: boolean } = {},
): Promise<TaskRow[]> {
  const supabase = await createClient();
  let q = supabase
    .from('tasks')
    .select(TASK_COLS)
    .eq('assignee_id', userId)
    .is('deleted_at', null)
    .limit(2000);
  q = opts.includeCompleted
    ? q.not('completed_at', 'is', null).order('completed_at', { ascending: false }).limit(200)
    : q.is('completed_at', null);
  const { data, error } = await q;
  if (error) return [];
  return attachCounts((data ?? []) as unknown as TaskRow[]);
}

/** 会員に紐付くタスク(会員詳細の関連。未完了を先に) */
export async function listTasksByMember(memberId: string, limit = 100): Promise<TaskRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_COLS)
    .eq('member_id', memberId)
    .is('deleted_at', null)
    .order('completed_at', { ascending: true, nullsFirst: true })
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as unknown as TaskRow[];
}

export interface TaskDetail extends TaskRow {
  parent?: { id: number; name: string } | null;
  subtasks: TaskRow[];
  comments: TaskComment[];
  attachments: TaskAttachment[];
}

export async function getTask(id: number): Promise<TaskDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_COLS)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error || !data) return null;
  const task = data as unknown as TaskRow;
  const [parent, subs, comments, attachments] = await Promise.all([
    task.parent_task_id
      ? supabase.from('tasks').select('id, name').eq('id', task.parent_task_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('tasks')
      .select(TASK_COLS)
      .eq('parent_task_id', id)
      .is('deleted_at', null)
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true }),
    supabase
      .from('task_comments')
      .select(
        'id, task_id, user_id, author_name_raw, body, created_at, user:users!task_comments_user_id_fkey(id, full_name, avatar_path)',
      )
      .eq('task_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('task_attachments')
      .select(
        'id, task_id, filename, content_type, size_bytes, storage_path, uploaded_by, created_at',
      )
      .eq('task_id', id)
      .order('created_at', { ascending: true }),
  ]);
  return {
    ...task,
    parent: (parent.data as { id: number; name: string } | null) ?? null,
    subtasks: (subs.data ?? []) as unknown as TaskRow[],
    comments: (comments.data ?? []) as unknown as TaskComment[],
    attachments: (attachments.data ?? []) as unknown as TaskAttachment[],
  };
}

/** マイフォルダ(migration 110)。フォルダと、その中のプロジェクト ID(並び順) */
export interface TaskUserFolder {
  id: number;
  name: string;
  projectIds: number[];
}

/**
 * 自分のマイフォルダ(migration 110)。フォルダは sort_order → id 順、フォルダ内のプロジェクトは sort_order 順。
 * テーブル未適用なら空配列(画面を壊さない)。メーラーの listMyMailUserFolders と同じ形。
 */
export async function listMyTaskUserFolders(): Promise<TaskUserFolder[]> {
  const supabase = await createClient();
  const [{ data: folders, error: fErr }, { data: items, error: iErr }] = await Promise.all([
    supabase
      .from('task_user_folders')
      .select('id, name, sort_order')
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true }),
    supabase
      .from('task_user_folder_items')
      .select('folder_id, project_id, sort_order')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
  ]);
  if (fErr || iErr) return [];
  const byFolder = new Map<number, number[]>();
  for (const it of (items ?? []) as unknown as Array<{ folder_id: number; project_id: number }>) {
    const list = byFolder.get(Number(it.folder_id)) ?? [];
    list.push(Number(it.project_id));
    byFolder.set(Number(it.folder_id), list);
  }
  return ((folders ?? []) as unknown as Array<{ id: number; name: string }>).map((f) => ({
    id: Number(f.id),
    name: f.name,
    projectIds: byFolder.get(Number(f.id)) ?? [],
  }));
}

/**
 * タスク名の部分一致検索(検索ページ `/task/search`。2026-09-22)。閲覧できるプロジェクトのタスクだけ(RLS)。
 * 未完了を先に、更新が新しい順。上限 50 件。
 */
export async function searchTasks(q: string, limit = 50): Promise<TaskRow[]> {
  const term = q.trim().replace(/[%_,]/g, ' ').trim();
  if (!term) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_COLS)
    .ilike('name', `%${term}%`)
    .is('deleted_at', null)
    .order('completed_at', { ascending: true, nullsFirst: true })
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return attachCounts((data ?? []) as unknown as TaskRow[]);
}
