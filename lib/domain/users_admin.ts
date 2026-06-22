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

export async function listAllUsers(): Promise<AdminUserRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('users')
    .select(
      'id, email, full_name, first_name, last_name, role, is_active, legacy_sf_id, created_at',
    )
    .is('deleted_at', null)
    .order('role', { ascending: true })
    .order('full_name', { ascending: true, nullsFirst: false });
  if (error) throw new Error(`ユーザー一覧取得に失敗: ${error.message}`);
  return (data ?? []) as AdminUserRow[];
}
