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
  protectCount: number;          // 自分が設定した有効プロテクト数
  // ---- 申込オブジェクト: acquirer_id (申込獲得者) ベース集計 ----
  monthPaymentCount: number;     // 今月の入金件数
  monthPaymentAmount: number;    // 今月の入金額合計
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

  const monthEnd = new Date();
  monthEnd.setMonth(monthEnd.getMonth() + 1);
  monthEnd.setDate(1);
  monthEnd.setHours(0, 0, 0, 0);
  const monthEndIso = monthEnd.toISOString();

  const [
    todayCount,
    monthCount,
    protectCount,
    monthPaymentRows,
  ] = await Promise.all([
    // 今日の対応件数
    supabase
      .from('activities')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .eq('owner_id', userId)
      .gte('registered_datetime', today),
    // 今月の対応件数
    supabase
      .from('activities')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .eq('owner_id', userId)
      .gte('registered_datetime', monthStart),
    // 有効プロテクト数
    supabase
      .from('members')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .eq('protect_by_user_id', userId)
      .not('protect_expires_at', 'is', null)
      .gt('protect_expires_at', now),
    // 今月の入金件数・入金額(acquirer_id ベース)
    supabase
      .from('applications')
      .select('payment_amount')
      .is('deleted_at', null)
      .eq('acquirer_id', userId)
      .not('payment_amount', 'is', null)
      .gt('payment_amount', 0)
      .gte('payment_date', monthStart.slice(0, 10))
      .lt('payment_date', monthEndIso.slice(0, 10)),
  ]);

  const paymentRows = (monthPaymentRows.data ?? []) as { payment_amount: number | null }[];
  const monthPaymentCount = paymentRows.length;
  const monthPaymentAmount = paymentRows.reduce((sum, r) => sum + (r.payment_amount ?? 0), 0);

  return {
    todayActivities: todayCount.count ?? 0,
    monthActivities: monthCount.count ?? 0,
    protectCount: protectCount.count ?? 0,
    monthPaymentCount,
    monthPaymentAmount,
  };
}

export interface ProtectSectionData {
  /** 表示する行(3日以内があればそれのみ、なければ全件を最大20件) */
  rows: ProtectExpiringMember[];
  /** 3日以内解除の件数(ハイライト判定に使用) */
  expiringSoonCount: number;
  /** 全有効プロテクト件数 */
  totalCount: number;
}

/**
 * ダッシュボードのプロテクト会員セクション用データを返す。
 * - 3日以内に解除される会員がいる → それを全件返す
 * - いない場合 → 有効プロテクト全件を解除日時昇順で最大20件返す
 */
export async function getProtectExpiringSoon(userId: string): Promise<ProtectSectionData> {
  const supabase = await createClient();
  const now = new Date().toISOString();
  const in3Days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

  const SELECT = `id, name, protect_expires_at,
     protect_by_user:users!members_protect_by_user_id_fkey(id, full_name)`;

  // 3日以内に解除されるものを取得
  const { data: soonData, error: soonErr } = await supabase
    .from('members')
    .select(SELECT)
    .is('deleted_at', null)
    .eq('protect_by_user_id', userId)
    .gt('protect_expires_at', now)
    .lte('protect_expires_at', in3Days)
    .order('protect_expires_at', { ascending: true })
    .limit(50);

  if (soonErr) return { rows: [], expiringSoonCount: 0, totalCount: 0 };

  const soonRows = (soonData ?? []) as unknown as ProtectExpiringMember[];

  if (soonRows.length > 0) {
    // 全件カウントも取得
    const { count: total } = await supabase
      .from('members')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .eq('protect_by_user_id', userId)
      .not('protect_expires_at', 'is', null)
      .gt('protect_expires_at', now);

    return {
      rows: soonRows,
      expiringSoonCount: soonRows.length,
      totalCount: total ?? soonRows.length,
    };
  }

  // 該当なし → 全有効プロテクトを最大20件返す
  const { data: allData, error: allErr } = await supabase
    .from('members')
    .select(SELECT)
    .is('deleted_at', null)
    .eq('protect_by_user_id', userId)
    .not('protect_expires_at', 'is', null)
    .gt('protect_expires_at', now)
    .order('protect_expires_at', { ascending: true })
    .limit(20);

  if (allErr) return { rows: [], expiringSoonCount: 0, totalCount: 0 };
  const allRows = (allData ?? []) as unknown as ProtectExpiringMember[];
  return { rows: allRows, expiringSoonCount: 0, totalCount: allRows.length };
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
