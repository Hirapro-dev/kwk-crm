import { createClient } from '@/lib/supabase/server';
import type { ActivityListItem } from './types';

/**
 * ダッシュボード用の集計クエリ群(仕様書 §9.15)。
 *
 * Phase 4 時点では生の count クエリで実装。
 * 仕様書 §9.13 のとおり、Phase 6 で mv_monthly_activities を活用する余地あり。
 */

export interface DashboardStats {
  todayActivities: number;
  monthActivities: number;
  protectCount: number; // 自分が設定した有効プロテクト数
}

export interface ProtectExpiringMember {
  id: string;
  name: string | null;
  protect_expires_at: string;
  protect_by_user: { id: string; full_name: string | null } | null;
}

function todayStartIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function monthStartIso(): string {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function getMyDashboardStats(userId: string): Promise<DashboardStats> {
  const supabase = await createClient();
  const today = todayStartIso();
  const monthStart = monthStartIso();
  const now = new Date().toISOString();

  const [todayCount, monthCount, protectCount] = await Promise.all([
    supabase
      .from('activities')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .eq('owner_id', userId)
      .gte('registered_datetime', today),
    supabase
      .from('activities')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .eq('owner_id', userId)
      .gte('registered_datetime', monthStart),
    supabase
      .from('members')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .eq('protect_by_user_id', userId)
      .not('protect_expires_at', 'is', null)
      .gt('protect_expires_at', now),
  ]);

  return {
    todayActivities: todayCount.count ?? 0,
    monthActivities: monthCount.count ?? 0,
    protectCount: protectCount.count ?? 0,
  };
}

/** 自分がプロテクト設定した会員で、3日以内に解除期限が来るものを返す。 */
export async function getProtectExpiringSoon(
  userId: string,
): Promise<ProtectExpiringMember[]> {
  const supabase = await createClient();
  const now = new Date().toISOString();
  const in3Days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('members')
    .select(
      `id, name, protect_expires_at,
       protect_by_user:users!members_protect_by_user_id_fkey(id, full_name)`,
    )
    .is('deleted_at', null)
    .eq('protect_by_user_id', userId)
    .gt('protect_expires_at', now)
    .lte('protect_expires_at', in3Days)
    .order('protect_expires_at', { ascending: true })
    .limit(50);

  if (error) return [];
  return (data ?? []) as unknown as ProtectExpiringMember[];
}

/** 過去 24 時間の全員の対応歴を返す(ダッシュボード用)。 */
export async function getRecentActivities24h(limit = 100): Promise<ActivityListItem[]> {
  const supabase = await createClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('activities')
    .select(
      `id, legacy_sf_id, owner_id, member_id, created_by_id,
       description, d_bunrui, m_bunrui, s_bunrui,
       registered_date, registered_datetime, created_at, updated_at,
       owner:users!activities_owner_id_fkey(id, full_name),
       member:members!activities_member_id_fkey(id, name)`,
    )
    .is('deleted_at', null)
    .gte('registered_datetime', since)
    .order('registered_datetime', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) return [];
  return (data ?? []) as unknown as ActivityListItem[];
}

/** 現在有効なプロテクト全件を解除期限昇順で返す(フロー設定ページ用)。 */
export async function getAllActiveProtects(): Promise<ProtectExpiringMember[]> {
  const supabase = await createClient();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('members')
    .select(
      `id, name, protect_expires_at,
       protect_by_user:users!members_protect_by_user_id_fkey(id, full_name)`,
    )
    .is('deleted_at', null)
    .not('protect_expires_at', 'is', null)
    .gt('protect_expires_at', now)
    .order('protect_expires_at', { ascending: true })
    .limit(200);

  if (error) return [];
  return (data ?? []) as unknown as ProtectExpiringMember[];
}

/** @deprecated 後方互換。page.tsx から直接は使わず getRecentActivities24h を使うこと。 */
export async function getMyRecentActivities(
  userId: string,
  limit = 10,
): Promise<ActivityListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('activities')
    .select(
      `id, legacy_sf_id, owner_id, member_id, created_by_id,
       description, d_bunrui, m_bunrui, s_bunrui,
       registered_date, registered_datetime, created_at, updated_at,
       owner:users!activities_owner_id_fkey(id, full_name),
       member:members!activities_member_id_fkey(id, name)`,
    )
    .is('deleted_at', null)
    .eq('owner_id', userId)
    .order('registered_datetime', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as unknown as ActivityListItem[];
}
