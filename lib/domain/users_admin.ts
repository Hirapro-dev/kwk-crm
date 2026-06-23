import { createClient } from '@/lib/supabase/server';
import type { UserRole } from './types';

export interface AdminUserRow {
  id: string;
  email: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  role: UserRole;
  is_active: boolean;
  legacy_sf_id: string | null;
  created_at: string;
}

export async function listAllUsers(opts?: {
  /** true なら有効(is_active=true)のみ。既定は false(全件)。 */
  activeOnly?: boolean;
  /** 指定ロールのみに絞り込む。未指定は全ロール。 */
  role?: UserRole;
}): Promise<AdminUserRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from('users')
    .select(
      'id, email, full_name, first_name, last_name, role, is_active, legacy_sf_id, created_at',
    )
    .is('deleted_at', null);

  if (opts?.activeOnly) query = query.eq('is_active', true);
  if (opts?.role) query = query.eq('role', opts.role);

  const { data, error } = await query
    .order('role', { ascending: true })
    .order('full_name', { ascending: true, nullsFirst: false });
  if (error) throw new Error(`ユーザー一覧取得に失敗: ${error.message}`);
  return (data ?? []) as AdminUserRow[];
}

export async function getUserById(id: string): Promise<AdminUserRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('users')
    .select(
      'id, email, full_name, first_name, last_name, role, is_active, legacy_sf_id, created_at',
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(`ユーザー取得に失敗: ${error.message}`);
  return (data as AdminUserRow) ?? null;
}
