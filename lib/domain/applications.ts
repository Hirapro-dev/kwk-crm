import { createClient } from '@/lib/supabase/server';

import type { AppStatus } from './applications_constants';
export { ALL_APP_STATUSES, APP_STATUSES, type AppStatus } from './applications_constants';

export interface ApplicationListItem {
  id: string;
  member_id: string;
  project_id: number;
  application_date: string;
  status: AppStatus | null;
  payment_amount: number | null;
  payment_date: string | null;
  scheduled_payment_date: string | null;
  scheduled_amount: number | null;
  withdrawal_amount: number | null;
  withdrawal_date: string | null;
  transfer_amount: number | null;
  transfer_date: string | null;
  transfer_to: string | null;
  crypto_excluded_amount: number | null;
  yen_interest: number | null;
  /** 利息種別(月利 / 年利 / 契約期間内。migration 121) */
  interest_type: string | null;
  interest: number | null;
  transfer_from: string | null;
  campaign_target_amount: number | null;
  contract_period: string | null;
  contract_end_date: string | null;
  contract_sent_date: string | null;
  start_month: string | null;
  /** 起算日(timestamptz。表示は日本時間の日付。§5.6) */
  start_datetime?: string | null;
  owner_id: string | null;
  acquirer_id: string | null;
  owner_name_raw: string | null;
  acquirer_name_raw: string | null;
  inquiry_id: string | null;
  extra: Record<string, unknown> | null;
  /** 詳細(getApplication)では会員の電話(1〜3。2・3 は extra)・メール(1〜3)・住所も読む(会員情報カード。2026-10-07) */
  member: {
    id: string;
    name: string;
    phone1?: string | null;
    phone2?: string | null;
    phone3?: string | null;
    email1?: string | null;
    email2?: string | null;
    email3?: string | null;
    address?: string | null;
  } | null;
  project: { id: number; name: string } | null;
  owner: { id: string; full_name: string | null } | null;
  acquirer: { id: string; full_name: string | null } | null;
}

export interface Application extends ApplicationListItem {
  inquiry_id: string | null;
  acquirer_id: string | null;
  acquirer_name_raw: string | null;
  /** 申込獲得者(acquirer_id) → users への JOIN 結果 */
  acquirer: { id: string; full_name: string | null } | null;
  owner_name_raw: string | null;
  contract_sent_date: string | null;
  start_month: string | null;
  start_datetime: string | null;
  payment_date: string | null;
  crypto_excluded_amount: number | null;
  yen_interest: number | null;
  withdrawal_amount: number | null;
  withdrawal_date: string | null;
  transfer_date: string | null;
  transfer_amount: number | null;
  transfer_to: string | null;
  contract_period: string | null;
  /** 契約期日(契約期間の終了日。migration 107) */
  contract_end_date: string | null;
  /** 利息種別(月利 / 年利 / 契約期間内。migration 121) */
  interest_type: string | null;
  /** 利息。円金利 yen_interest とは別(migration 107) */
  interest: number | null;
  /** 資金移動元(migration 108) */
  transfer_from: string | null;
  /** ｷｬﾝﾍﾟｰﾝ対象金額(migration 108) */
  campaign_target_amount: number | null;
  extra: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ApplicationListParams {
  q?: string; // M-ID or member_id 検索
  /** 案件ID(T-…。projects.id は text) */
  projectId?: string;
  status?: AppStatus;
  ownerId?: string;
  memberId?: string;
  /**
   * サマリの入金一覧(§8.1 `/summary`)用: 入金額が 0 より大きい申込だけ。並びの既定は入金日の新しい順。
   * 期間(入金日)と申込獲得者はこのときだけ使う(lib/domain/payment_list.ts)
   */
  paymentOnly?: boolean;
  /** 入金日の開始(YYYY-MM-DD, inclusive) */
  paymentFrom?: string;
  /** 入金日の終了(YYYY-MM-DD, inclusive) */
  paymentTo?: string;
  /** 申込獲得者で絞る(空配列なら 0 件) */
  acquirerIds?: string[];
  sort?: string;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

/** 一覧でソート可能な applications カラム(ホワイトリスト) */
const APPLICATION_SORTABLE = new Set<string>([
  'id',
  'member_id',
  'project_id',
  'application_date',
  'status',
  'payment_amount',
  'payment_date',
  'scheduled_payment_date',
  'scheduled_amount',
  'owner_id',
  'withdrawal_amount',
  'withdrawal_date',
]);

export interface ApplicationListResult {
  rows: ApplicationListItem[];
  total: number;
  page: number;
  pageSize: number;
}

const DEFAULT_PAGE_SIZE = 50;

/** 一覧と CSV で同じ列を読む */
const APPLICATION_LIST_SELECT = `
        id, member_id, project_id, application_date, status,
        payment_amount, payment_date, scheduled_payment_date, scheduled_amount,
        withdrawal_amount, withdrawal_date, transfer_amount, transfer_date, transfer_to,
        crypto_excluded_amount, yen_interest, interest_type, interest, transfer_from, campaign_target_amount,
        contract_period, contract_end_date, contract_sent_date, start_datetime,
        start_month, owner_id, acquirer_id, owner_name_raw, acquirer_name_raw, inquiry_id, extra,
        member:members!applications_member_id_fkey(id, name),
        project:projects!applications_project_id_fkey(id, name),
        owner:users!applications_owner_id_fkey(id, full_name),
        acquirer:users!applications_acquirer_id_fkey(id, full_name)
      `;

/** 一覧と CSV で共通の絞り込み・並び(呼び出し側で .range() を足す) */
function buildApplicationQuery(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: ApplicationListParams,
  withCount: boolean,
) {
  let query = supabase
    .from('applications')
    .select(APPLICATION_LIST_SELECT, withCount ? { count: 'exact' } : undefined)
    .is('deleted_at', null);

  const sorted = !!params.sort && APPLICATION_SORTABLE.has(params.sort);
  if (sorted && params.sort) {
    query = query.order(params.sort, {
      ascending: params.dir !== 'desc',
      nullsFirst: false,
    });
  }
  // 既定の並び: 入金一覧は入金日、それ以外は申込日の新しい順。同じ日の並びを決めるため申込ID を最後に付ける
  query = query
    .order(params.paymentOnly ? 'payment_date' : 'application_date', {
      ascending: false,
      nullsFirst: false,
    })
    .order('id', { ascending: false });

  if (params.q?.trim()) {
    const q = params.q.trim().replace(/[%_]/g, '\\$&');
    query = query.or(`id.ilike.%${q}%,member_id.ilike.%${q}%`);
  }
  if (params.projectId) query = query.eq('project_id', params.projectId);
  if (params.status) query = query.eq('status', params.status);
  if (params.ownerId) query = query.eq('owner_id', params.ownerId);
  if (params.memberId) query = query.eq('member_id', params.memberId);
  if (params.paymentOnly) {
    query = query.not('payment_amount', 'is', null).gt('payment_amount', 0);
    if (params.paymentFrom) query = query.gte('payment_date', params.paymentFrom);
    if (params.paymentTo) query = query.lte('payment_date', params.paymentTo);
  }
  if (params.acquirerIds) query = query.in('acquirer_id', params.acquirerIds);
  return query;
}

export async function listApplications(
  params: ApplicationListParams = {},
): Promise<ApplicationListResult> {
  const supabase = await createClient();
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, params.pageSize ?? DEFAULT_PAGE_SIZE));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // 申込獲得者の候補が空なら 0 件(in() に空配列を渡さない)
  if (params.acquirerIds && params.acquirerIds.length === 0) {
    return { rows: [], total: 0, page, pageSize };
  }
  const query = buildApplicationQuery(supabase, params, true).range(from, to);

  const { data, error, count } = await query;
  if (error) throw new Error(`申込一覧取得に失敗: ${error.message}`);
  return {
    rows: (data ?? []) as unknown as ApplicationListItem[],
    total: count ?? 0,
    page,
    pageSize,
  };
}

/** CSV 出力で一度に取り出せる上限。これを超える条件は絞り込みを促す(対応歴の CSV と同じ) */
export const APPLICATION_EXPORT_MAX_ROWS = 50_000;
/** PostgREST が 1 回に返す最大行数(db-max-rows) */
const EXPORT_CHUNK = 1000;

/**
 * CSV 出力用に、一覧と同じ絞り込み・並びで全件を取り出す(1,000 件ずつ)。
 * 総件数が上限を超えるときは取得せず tooMany を返す(途中まで出すと「全部出た」と誤解されるため)。
 */
export async function exportApplications(
  params: ApplicationListParams,
): Promise<{ rows: ApplicationListItem[]; total: number; tooMany: boolean }> {
  if (params.acquirerIds && params.acquirerIds.length === 0) {
    return { rows: [], total: 0, tooMany: false };
  }
  const supabase = await createClient();
  const first = await buildApplicationQuery(supabase, params, true).range(0, EXPORT_CHUNK - 1);
  if (first.error) throw new Error(`申込の取得に失敗: ${first.error.message}`);
  const total = first.count ?? 0;
  if (total > APPLICATION_EXPORT_MAX_ROWS) return { rows: [], total, tooMany: true };

  const rows = (first.data ?? []) as unknown as ApplicationListItem[];
  for (let offset = EXPORT_CHUNK; offset < total; offset += EXPORT_CHUNK) {
    const next = await buildApplicationQuery(supabase, params, false).range(
      offset,
      offset + EXPORT_CHUNK - 1,
    );
    if (next.error) throw new Error(`申込の取得に失敗: ${next.error.message}`);
    const chunk = (next.data ?? []) as unknown as ApplicationListItem[];
    if (chunk.length === 0) break;
    rows.push(...chunk);
  }
  return { rows, total, tooMany: false };
}

export async function getApplication(id: string): Promise<Application | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('applications')
    .select(
      `
        id, inquiry_id, member_id, project_id, application_date, status,
        owner_id, owner_name_raw, acquirer_id, acquirer_name_raw,
        contract_sent_date, start_month, start_datetime,
        scheduled_payment_date, scheduled_amount,
        payment_date, payment_amount, crypto_excluded_amount, yen_interest, interest_type, interest,
        withdrawal_amount, withdrawal_date,
        transfer_date, transfer_amount, transfer_to, transfer_from, campaign_target_amount,
        contract_period, contract_end_date, extra, created_at, updated_at,
        member:members!applications_member_id_fkey(id, name, phone1, email1, email2, email3, address, phone2:extra->>電話番号2, phone3:extra->>電話番号3),
        project:projects!applications_project_id_fkey(id, name),
        owner:users!applications_owner_id_fkey(id, full_name),
        acquirer:users!applications_acquirer_id_fkey(id, full_name)
      `,
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(`申込取得に失敗: ${error.message}`);
  return (data as unknown as Application) ?? null;
}
