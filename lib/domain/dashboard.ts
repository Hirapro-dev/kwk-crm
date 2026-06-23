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
  monthMembers: number; // 自分担当の会員数(参考)
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

  const [todayCount, monthCount, members] = await Promise.all([
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
      .eq('owner_id', userId),
  ]);

  return {
    todayActivities: todayCount.count ?? 0,
    monthActivities: monthCount.count ?? 0,
    monthMembers: members.count ?? 0,
  };
}

export async function getMyRecentActivities(
  userId: string,
  limit = 10,
): Promise<ActivityListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('activities')
    .select(
      `
        id, legacy_sf_id, owner_id, member_id, created_by_id,
        description, d_bunrui, m_bunrui, s_bunrui,
        registered_date, registered_datetime, created_at, updated_at,
        owner:users!activities_owner_id_fkey(id, full_name),
        member:members!activities_member_id_fkey(id, name)
      `,
    )
    .is('deleted_at', null)
    .eq('owner_id', userId)
    .order('registered_datetime', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as unknown as ActivityListItem[];
}
