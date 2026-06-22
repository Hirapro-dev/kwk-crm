import { createClient } from '@/lib/supabase/server';

export type AppStatus = '対応中' | '未購入' | '完了' | '出金' | '資金移動';
export type FlowType = '入金' | '出金' | '資金移動' | 'W';

export const APP_STATUSES: AppStatus[] = ['対応中', '未購入', '完了', '出金', '資金移動'];
export const FLOW_TYPES: FlowType[] = ['入金', '出金', '資金移動', 'W'];

export interface ApplicationListItem {
  id: string;
  member_id: string;
  project_id: number;
  application_date: string;
  status: AppStatus | null;
  flow_type: FlowType | null;
  payment_amount: number | null;
  scheduled_payment_date: string | null;
  scheduled_amount: number | null;
  owner_id: string | null;
  member: { id: string; name: string } | null;
  project: { id: number; name: string } | null;
  owner: { id: string; full_name: string | null } | null;
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
  extra: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ApplicationListParams {
  q?: string; // M-ID or member_id 検索
  projectId?: number;
  status?: AppStatus;
  ownerId?: string;
  memberId?: string;
  page?: number;
  pageSize?: number;
}

export interface ApplicationListResult {
  rows: ApplicationListItem[];
  total: number;
  page: number;
  pageSize: number;
}

const DEFAULT_PAGE_SIZE = 50;

export async function listApplications(
  params: ApplicationListParams = {},
): Promise<ApplicationListResult> {
  const supabase = await createClient();
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, params.pageSize ?? DEFAULT_PAGE_SIZE));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('applications')
    .select(
      `
        id, member_id, project_id, application_date, status, flow_type,
        payment_amount, scheduled_payment_date, scheduled_amount, owner_id,
        member:members!applications_member_id_fkey(id, name),
        project:projects!applications_project_id_fkey(id, name),
        owner:users!applications_owner_id_fkey(id, full_name)
      `,
      { count: 'exact' },
    )
    .is('deleted_at', null)
    .order('application_date', { ascending: false, nullsFirst: false })
    .range(from, to);

  if (params.q && params.q.trim()) {
    const q = params.q.trim().replace(/[%_]/g, '\\$&');
    query = query.or(`id.ilike.%${q}%,member_id.ilike.%${q}%`);
  }
  if (params.projectId) query = query.eq('project_id', params.projectId);
  if (params.status) query = query.eq('status', params.status);
  if (params.ownerId) query = query.eq('owner_id', params.ownerId);
  if (params.memberId) query = query.eq('member_id', params.memberId);

  const { data, error, count } = await query;
  if (error) throw new Error(`申込一覧取得に失敗: ${error.message}`);
  return {
    rows: (data ?? []) as unknown as ApplicationListItem[],
    total: count ?? 0,
    page,
    pageSize,
  };
}

export async function getApplication(id: string): Promise<Application | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('applications')
    .select(
      `
        id, inquiry_id, member_id, project_id, application_date, status, flow_type,
        owner_id, owner_name_raw, acquirer_id, acquirer_name_raw,
        contract_sent_date, start_month, start_datetime,
        scheduled_payment_date, scheduled_amount,
        payment_date, payment_amount, crypto_excluded_amount, yen_interest,
        withdrawal_amount, withdrawal_date,
        transfer_date, transfer_amount, transfer_to,
        contract_period, extra, created_at, updated_at,
        member:members!applications_member_id_fkey(id, name),
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
