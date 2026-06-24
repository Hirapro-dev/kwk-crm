/**
 * アプリ全体で使う軽量ドメイン型(自動生成 lib/supabase/types.ts が空のため暫定定義)。
 * supabase gen types が走ったら、可能な限りそちらの型を再利用する。
 */

export type UserRole = 'admin' | 'manager' | 'sales' | 'viewer';

export interface AppUser {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
}

export interface Member {
  id: string;
  name: string;
  name_kana: string | null;
  email1: string | null;
  email2: string | null;
  email3: string | null;
  phone1: string | null;
  do_not_call: boolean;
  address: string | null;
  postal_code: string | null;
  customer_type: string | null;
  owner_id: string | null;
  owner_name_raw: string | null;
  regular_contact_id: string | null;
  protect_by_user_id: string | null;
  protect_expires_at: string | null;
  total_amount: number | null;
  total_paid_amount: number | null;
  total_used_amount: number | null;
  registered_at: string | null;
  /** フォーム固有/可変項目(弁護士対応・番号違い等のフラグもここに格納) */
  extra: Record<string, unknown> | null;
  deleted_at: string | null;
}

export interface MemberWithOwner extends Member {
  owner: { id: string; full_name: string | null; email: string } | null;
  regular_contact: { id: string; full_name: string | null; email: string } | null;
  protect_by_user: { id: string; full_name: string | null } | null;
}

export type ActivityStatus = '対応中' | '未購入' | '完了' | '出金' | '資金移動';

export interface Activity {
  id: number;
  legacy_sf_id: string | null;
  owner_id: string | null;
  member_id: string | null;
  created_by_id: string | null;
  description: string | null;
  d_bunrui: string | null;
  m_bunrui: string | null;
  s_bunrui: string | null;
  registered_date: string | null;
  registered_datetime: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActivityListItem extends Activity {
  owner: { id: string; full_name: string | null } | null;
  member: { id: string; name: string } | null;
}
