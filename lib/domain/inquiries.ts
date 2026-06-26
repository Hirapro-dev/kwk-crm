import { createClient } from '@/lib/supabase/server';

export interface InquiryListItem {
  id: string;
  form_id: number | null;
  member_id: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  registered_at: string;
  created_at: string;
  form: { id: number; name: string; category: string | null } | null;
  member: { id: string; name: string } | null;
}

export interface Inquiry extends InquiryListItem {
  name_kana: string | null;
  postal_code: string | null;
  address: string | null;
  ad_id: string | null;
  extra: Record<string, unknown>;
}

export interface InquiryListParams {
  q?: string;
  formId?: number;
  /** 未対応 = member_id IS NULL */
  unassigned?: boolean;
  /** 特定会員に紐づく問合せのみ抽出 (会員詳細ページの「関連」タブで利用) */
  memberId?: string;
  from?: string;
  to?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

/** 一覧でソート可能な inquiries カラム(ホワイトリスト) */
const INQUIRY_SORTABLE = new Set<string>([
  'id',
  'registered_at',
  'form_id',
  'member_id',
  'name',
  'email',
  'phone',
  'created_at',
]);

export interface InquiryListResult {
  rows: InquiryListItem[];
  total: number;
  page: number;
  pageSize: number;
}

const DEFAULT_PAGE_SIZE = 50;

export async function listInquiries(params: InquiryListParams = {}): Promise<InquiryListResult> {
  const supabase = await createClient();
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, params.pageSize ?? DEFAULT_PAGE_SIZE));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('inquiries')
    .select(
      `
        id, form_id, member_id, name, name_kana, email, phone,
        postal_code, address, ad_id, extra, registered_at, created_at,
        form:forms!inquiries_form_id_fkey(id, name, category),
        member:members!inquiries_member_id_fkey(id, name)
      `,
      { count: 'exact' },
    )
    .is('deleted_at', null);

  if (params.sort && INQUIRY_SORTABLE.has(params.sort)) {
    query = query.order(params.sort, {
      ascending: params.dir !== 'desc',
      nullsFirst: false,
    });
  }
  query = query.order('registered_at', { ascending: false }).range(from, to);

  if (params.q && params.q.trim()) {
    const q = params.q.trim().replace(/[%_]/g, '\\$&');
    query = query.or(
      `id.ilike.%${q}%,name.ilike.%${q}%,name_kana.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`,
    );
  }
  if (params.formId) query = query.eq('form_id', params.formId);
  if (params.unassigned) query = query.is('member_id', null);
  if (params.memberId) query = query.eq('member_id', params.memberId);
  if (params.from) query = query.gte('registered_at', params.from);
  if (params.to) query = query.lte('registered_at', params.to);

  const { data, error, count } = await query;
  if (error) throw new Error(`問合せ一覧取得に失敗: ${error.message}`);
  return {
    rows: (data ?? []) as unknown as InquiryListItem[],
    total: count ?? 0,
    page,
    pageSize,
  };
}

export async function getInquiry(id: string): Promise<Inquiry | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('inquiries')
    .select(
      `
        id, form_id, member_id, name, name_kana, email, phone,
        postal_code, address, ad_id, extra, registered_at, created_at,
        form:forms!inquiries_form_id_fkey(id, name, category),
        member:members!inquiries_member_id_fkey(id, name)
      `,
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(`問合せ取得に失敗: ${error.message}`);
  return (data as unknown as Inquiry) ?? null;
}

export async function listForms(): Promise<
  { id: number; name: string; category: string | null }[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('forms')
    .select('id, name, category')
    .eq('is_active', true)
    .order('name');
  if (error) return [];
  return (data ?? []) as { id: number; name: string; category: string | null }[];
}
