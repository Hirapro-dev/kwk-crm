import { createClient, createServiceRoleClient } from '@/lib/supabase/server';

/**
 * ユーザーのアクセス状況(最終ログイン等)を取得する。
 *
 * 最終ログイン日時(last_sign_in_at)は Supabase Auth(auth.users)が保持しており、
 * service_role の admin.listUsers() でのみ取得可能。
 * public.users(氏名・ロール・有効状態)と突合して返す。
 */
export interface UserAccessRow {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  last_sign_in_at: string | null;
  created_at: string | null;
}

export async function listUserAccessLog(): Promise<UserAccessRow[]> {
  try {
    const supabase = await createClient();
    const { data: profilesRaw } = await supabase
      .from('users')
      .select('id, email, full_name, role, is_active')
      .is('deleted_at', null);
    type Prof = {
      id: string;
      email: string;
      full_name: string | null;
      role: string;
      is_active: boolean;
    };
    const profiles = (profilesRaw ?? []) as unknown as Prof[];
    const profMap = new Map<string, Prof>(profiles.map((p) => [p.id, p]));

    const admin = createServiceRoleClient();
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error || !data) return [];

    type AuthUser = {
      id: string;
      email?: string | null;
      last_sign_in_at?: string | null;
      created_at?: string | null;
    };
    const rows: UserAccessRow[] = (data.users as AuthUser[]).map((u) => {
      const p = profMap.get(u.id);
      return {
        id: u.id,
        email: u.email ?? p?.email ?? '',
        full_name: p?.full_name ?? null,
        role: p?.role ?? '-',
        is_active: p?.is_active ?? false,
        last_sign_in_at: u.last_sign_in_at ?? null,
        created_at: u.created_at ?? null,
      };
    });

    // 最終ログインの新しい順(未ログインは末尾)
    rows.sort((a, b) => (b.last_sign_in_at ?? '').localeCompare(a.last_sign_in_at ?? ''));
    return rows;
  } catch {
    return [];
  }
}
