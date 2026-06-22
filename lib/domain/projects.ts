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

export async function listProjects(): Promise<Project[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, description, is_active, created_at, updated_at')
    .order('name', { ascending: true });
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
