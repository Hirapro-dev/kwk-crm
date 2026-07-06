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

/**
 * 指定ユーザーと同じ氏名(full_name)を持つ全アカウントのID群を返す(自分を含む)。
 * 同一人物が有効/無効の重複アカウントを持つ場合、それらに残るプロテクトを
 * 「一人分」として合算するために使う。full_name が無い/取得失敗時は [userId]。
 * ※ 同名の別人が居ると合算されうる(氏名を名寄せキーにしているため)点は許容。
 */
export async function getSameNameUserIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string[]> {
  const { data: me } = await supabase
    .from('users')
    .select('full_name')
    .eq('id', userId)
    .maybeSingle();
  const fullName = (me?.full_name as string | null) ?? null;
  if (!fullName) return [userId];
  const { data } = await supabase
    .from('users')
    .select('id')
    .eq('full_name', fullName)
    .is('deleted_at', null);
  const ids = new Set<string>([userId]);
  for (const u of (data ?? []) as { id: string }[]) ids.add(u.id);
  return [...ids];
}

export async function getMyDashboardStats(userId: string): Promise<DashboardStats> {
  const supabase = await createClient();
  const today = todayStartIso();
  const monthStart = monthStartIso();
  const now = new Date().toISOString();
  // 同名アカウント(有効/無効)に残る保持分も自分の一人分として合算する
  const protectIds = await getSameNameUserIds(supabase, userId);

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
    // 有効プロテクト数(自分+同名アカウント合算。サマリ/一覧と一致させる)
    supabase
      .from('members')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .not('protect_expires_at', 'is', null)
      .gt('protect_expires_at', now)
      .in('protect_by_user_id', protectIds),
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
    protectCompanyWide: false,
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
  // 自分+同名アカウント合算(カウントと一覧を一致させる)
  const protectIds = await getSameNameUserIds(supabase, userId);

  const SELECT = `id, name, address, protect_expires_at,
     protect_by_user:users!members_protect_by_user_id_fkey(id, full_name)`;

  // 3日以内に解除されるものを取得
  const { data: soonData, error: soonErr } = await supabase
    .from('members')
    .select(SELECT)
    .is('deleted_at', null)
    .gt('protect_expires_at', now)
    .lte('protect_expires_at', in3Days)
    .in('protect_by_user_id', protectIds)
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
      .not('protect_expires_at', 'is', null)
      .gt('protect_expires_at', now)
      .in('protect_by_user_id', protectIds);

    return {
      rows: soonRows,
      expiringSoonCount: soonRows.length,
      totalCount: total ?? soonRows.length,
    };
  }

  // 該当なし → 自分+同名アカウントの有効プロテクトを最大20件返す
  const { data: allData, error: allErr } = await supabase
    .from('members')
    .select(SELECT)
    .is('deleted_at', null)
    .not('protect_expires_at', 'is', null)
    .gt('protect_expires_at', now)
    .in('protect_by_user_id', protectIds)
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
 * @param userId 指定時はそのユーザー(+同名アカウント)が設定したプロテクトのみ(プロテクト一覧ページ用)。
 *               未指定なら全件(全プロテクト表示 / フロー設定ページ用)。
 *
 * 全プロテクトは250件超になりうるため、1000件ずつページングして全件取得する
 * (取りこぼしを防ぐ。安全上限として最大10,000件)。
 */
export async function getAllActiveProtects(userId?: string): Promise<ProtectExpiringMember[]> {
  const supabase = await createClient();
  const now = new Date().toISOString();
  const SELECT = `id, name, address, protect_expires_at,
       protect_by_user:users!members_protect_by_user_id_fkey(id, full_name)`;

  // userId 指定時は同名アカウント(有効/無効)も含めて一人分として集約する
  const holderIds = userId ? await getSameNameUserIds(supabase, userId) : undefined;

  const PAGE = 1000;
  const MAX = 10_000;
  const out: ProtectExpiringMember[] = [];
  for (let offset = 0; offset < MAX; offset += PAGE) {
    let query = supabase
      .from('members')
      .select(SELECT)
      .is('deleted_at', null)
      .not('protect_expires_at', 'is', null)
      .gt('protect_expires_at', now);
    if (holderIds) query = query.in('protect_by_user_id', holderIds);

    const { data, error } = await query
      .order('protect_expires_at', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) break;
    const rows = (data ?? []) as unknown as ProtectExpiringMember[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

// ---- 定期連絡者(regular_contact) セクション ----

export interface RegularContactMember {
  id: string;
  name: string | null;
  phone1: string | null;
  address: string | null;
}

export interface RegularContactSection {
  rows: RegularContactMember[];
  totalCount: number;
}

const REGULAR_CONTACT_SELECT = 'id, name, phone1, address';

/**
 * ダッシュボード用: ログインユーザーが定期連絡担当の会員を最大 limit 件 + 総件数で返す。
 * プロテクトと同様、同名アカウント(有効/無効)分も合算する。
 */
export async function getMyRegularContactSection(
  userId: string,
  limit = 20,
): Promise<RegularContactSection> {
  const supabase = await createClient();
  const ids = await getSameNameUserIds(supabase, userId);

  const [listRes, countRes] = await Promise.all([
    supabase
      .from('members')
      .select(REGULAR_CONTACT_SELECT)
      .is('deleted_at', null)
      .in('regular_contact_id', ids)
      .order('name', { ascending: true, nullsFirst: false })
      .limit(limit),
    supabase
      .from('members')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .in('regular_contact_id', ids),
  ]);

  const rows = (listRes.data ?? []) as unknown as RegularContactMember[];
  return { rows, totalCount: countRes.count ?? rows.length };
}

/**
 * 定期連絡担当の会員を全件(同名アカウント合算)返す。全一覧ページ用。
 * 1000件ずつページングして取りこぼしを防ぐ(安全上限10,000件)。
 */
export async function getAllMyRegularContacts(userId: string): Promise<RegularContactMember[]> {
  const supabase = await createClient();
  const ids = await getSameNameUserIds(supabase, userId);
  const PAGE = 1000;
  const MAX = 10_000;
  const out: RegularContactMember[] = [];
  for (let offset = 0; offset < MAX; offset += PAGE) {
    const { data, error } = await supabase
      .from('members')
      .select(REGULAR_CONTACT_SELECT)
      .is('deleted_at', null)
      .in('regular_contact_id', ids)
      .order('name', { ascending: true, nullsFirst: false })
      .range(offset, offset + PAGE - 1);
    if (error) break;
    const rows = (data ?? []) as unknown as RegularContactMember[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
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
