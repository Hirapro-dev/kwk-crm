import { createClient } from '@/lib/supabase/server';

/**
 * 2026-05 更新: projects.category カラム廃止。
 * 型・関数から category を削除。
 */

export interface Project {
  id: number;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** 並び替え可能な列(ホワイトリスト)。SortHeader の field と一致させる。 */
const PROJECT_SORTABLE: Record<string, string> = {
  id: 'id',
  name: 'name',
  description: 'description',
  is_active: 'is_active',
};

export async function listProjects(opts?: {
  sort?: string;
  dir?: 'asc' | 'desc';
}): Promise<Project[]> {
  const supabase = await createClient();
  // 不正な列名は既定(案件名)にフォールバック。値の連結はせずホワイトリストのみ使用。
  const col = (opts?.sort && PROJECT_SORTABLE[opts.sort]) || 'name';
  const ascending = opts?.dir !== 'desc';

  let query = supabase
    .from('projects')
    .select('id, name, description, is_active, created_at, updated_at')
    .order(col, { ascending });
  // 案件名以外で並べたときは、同値の並びが安定するよう案件名を第2キーにする
  if (col !== 'name') query = query.order('name', { ascending: true });

  const { data, error } = await query;
  if (error) throw new Error(`案件マスタ取得に失敗: ${error.message}`);
  return (data ?? []) as Project[];
}

export async function getProject(id: number): Promise<Project | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, description, is_active, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`案件取得に失敗: ${error.message}`);
  return (data as Project) ?? null;
}
