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
  /** 有効プロテクト数。admin/manager は全社累計、それ以外は自分保持分 */
  protectCount: number;
  /** protectCount が全社累計(admin/manager)なら true、自分分なら false */
  protectCompanyWide: boolean;
  // ---- 申込オブジェクト: acquirer_id (申込獲得者) ベース集計 ----
  monthPaymentCount: number; // 今月の入金件数
  monthPaymentAmount: number; // 今月の入金額合計
}

export interface ProtectExpiringMember {
  id: string;
  name: string | null;
  address: string | null;
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

export async function getMyDashboardStats(userId: string, role?: string): Promise<DashboardStats> {
  const supabase = await createClient();
  const today = todayStartIso();
  const monthStart = monthStartIso();
  const now = new Date().toISOString();
  // admin/manager は全社の有効プロテクト累計、それ以外は自分保持分
  const companyWide = role === 'admin' || role === 'manager';

  const monthEnd = new Date();
  monthEnd.setMonth(monthEnd.getMonth() + 1);
  monthEnd.setDate(1);
  monthEnd.setHours(0, 0, 0, 0);
  const monthEndIso = monthEnd.toISOString();

  const [todayCount, monthCount, protectCount, monthPaymentRows] = await Promise.all([
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
    // 有効プロテクト数(admin/manager は全社累計、それ以外は自分保持分)
    (() => {
      let q = supabase
        .from('members')
        .select('id', { count: 'exact', head: true })
        .is('deleted_at', null)
        .not('protect_expires_at', 'is', null)
        .gt('protect_expires_at', now);
      if (!companyWide) q = q.eq('protect_by_user_id', userId);
      return q;
    })(),
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
    protectCompanyWide: companyWide,
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
export async function getProtectExpiringSoon(
  userId: string,
  role?: string,
): Promise<ProtectSectionData> {
  const supabase = await createClient();
  const now = new Date().toISOString();
  const in3Days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  // admin/manager は全社のプロテクトを対象(カウントと一覧を一致させる)
  const companyWide = role === 'admin' || role === 'manager';

  const SELECT = `id, name, address, protect_expires_at,
     protect_by_user:users!members_protect_by_user_id_fkey(id, full_name)`;

  // 3日以内に解除されるものを取得
  let soonQuery = supabase
    .from('members')
    .select(SELECT)
    .is('deleted_at', null)
    .gt('protect_expires_at', now)
    .lte('protect_expires_at', in3Days);
  if (!companyWide) soonQuery = soonQuery.eq('protect_by_user_id', userId);
  const { data: soonData, error: soonErr } = await soonQuery
    .order('protect_expires_at', { ascending: true })
    .limit(50);

  if (soonErr) return { rows: [], expiringSoonCount: 0, totalCount: 0 };

  const soonRows = (soonData ?? []) as unknown as ProtectExpiringMember[];

  if (soonRows.length > 0) {
    // 全件カウントも取得
    let totalQuery = supabase
      .from('members')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .not('protect_expires_at', 'is', null)
      .gt('protect_expires_at', now);
    if (!companyWide) totalQuery = totalQuery.eq('protect_by_user_id', userId);
    const { count: total } = await totalQuery;

    return {
      rows: soonRows,
      expiringSoonCount: soonRows.length,
      totalCount: total ?? soonRows.length,
    };
  }

  // 該当なし → 全有効プロテクトを最大20件返す
  let allQuery = supabase
    .from('members')
    .select(SELECT)
    .is('deleted_at', null)
    .not('protect_expires_at', 'is', null)
    .gt('protect_expires_at', now);
  if (!companyWide) allQuery = allQuery.eq('protect_by_user_id', userId);
  const { data: allData, error: allErr } = await allQuery
    .order('protect_expires_at', { ascending: true })
    .limit(20);

  if (allErr) return { rows: [], expiringSoonCount: 0, totalCount: 0 };
  const allRows = (allData ?? []) as unknown as ProtectExpiringMember[];
  return { rows: allRows, expiringSoonCount: 0, totalCount: allRows.length };
}

/** 過去 24 時間の自分の対応歴を返す(ダッシュボード用)。 */
export async function getRecentActivities24h(
  userId: string,
  limit = 100,
): Promise<ActivityListItem[]> {
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
    .eq('owner_id', userId)
    .gte('registered_datetime', since)
    .order('registered_datetime', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) return [];
  return (data ?? []) as unknown as ActivityListItem[];
}

/**
 * 現在有効なプロテクトを解除期限昇順で返す。
 * @param userId 指定時はそのユーザーが設定したプロテクトのみ(プロテクト一覧ページ用)。
 *               未指定なら全件(フロー設定ページ用)。
 */
export async function getAllActiveProtects(userId?: string): Promise<ProtectExpiringMember[]> {
  const supabase = await createClient();
  const now = new Date().toISOString();

  let query = supabase
    .from('members')
    .select(
      `id, name, address, protect_expires_at,
       protect_by_user:users!members_protect_by_user_id_fkey(id, full_name)`,
    )
    .is('deleted_at', null)
    .not('protect_expires_at', 'is', null)
    .gt('protect_expires_at', now);

  if (userId) query = query.eq('protect_by_user_id', userId);

  const { data, error } = await query.order('protect_expires_at', { ascending: true }).limit(200);

  if (error) return [];
  return (data ?? []) as unknown as ProtectExpiringMember[];
}

/** 過去 N 日間の自分の対応歴を返す(対応歴一覧ページ用、日付グルーピング表示)。 */
export async function getRecentActivitiesNDays(
  userId: string,
  days = 7,
  limit = 500,
): Promise<ActivityListItem[]> {
  const supabase = await createClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

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
    .gte('registered_datetime', since)
    .order('registered_datetime', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) return [];
  return (data ?? []) as unknown as ActivityListItem[];
}

/**
 * 自分が対応者(owner_id)の対応歴を、期間制限なしで新しい順に返す(ダッシュボード用)。
 * 取込データなど登録日時が古いものも含めて直近N件を表示する。
 */
export async function getMyLatestActivities(
  userId: string,
  limit = 20,
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

/** @deprecated 後方互換。page.tsx から直接は使わず getMyLatestActivities を使うこと。 */
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
