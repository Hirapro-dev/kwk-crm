import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
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
  /** プロフィール画像(migration 114) */
  avatar_path?: string | null;
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
      'id, email, full_name, first_name, last_name, role, is_active, legacy_sf_id, created_at, avatar_path',
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

/**
 * 「現メンバー」(有効で、一度でもログインしたことがある人)。申込の新規登録の「申込獲得者」の選択肢に使う(2026-10-01)。
 * 有効なユーザーには「free」「会社プロテクト」「代表者／法人 リスト」のような人ではないアカウントや、
 * Salesforce から移したまま使われていないアカウントが含まれるため、ログイン実績で絞る。
 * ログイン実績は auth.users.last_sign_in_at(サービスロールで読む。返すのは氏名と ID だけ)。
 */
export async function listCurrentMembers(): Promise<AdminUserRow[]> {
  const users = await listAllUsers({ activeOnly: true });
  const admin = createServiceRoleClient();
  const signedIn = new Set<string>();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return users; // 取得できなければ従来どおり有効なユーザー全員
    for (const u of data.users) if (u.last_sign_in_at) signedIn.add(u.id);
    if (data.users.length < 1000) break;
  }
  return users
    .filter((u) => signedIn.has(u.id))
    .sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? '', 'ja'));
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
