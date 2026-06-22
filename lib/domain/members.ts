import { createClient } from '@/lib/supabase/server';
import type { Member, MemberWithOwner } from './types';

export interface MemberListParams {
  q?: string; // 名前 / kana / email / phone のあいまい検索
  ownerId?: string; // 'me' / 'free' / uuid
  customerType?: string;
  /** ソート列(ホワイトリストのみ) / 方向 */
  sort?: string;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

/** 一覧でソート可能な members カラム(SQL安全のためホワイトリスト) */
const MEMBER_SORTABLE = new Set<string>([
  'id', 'name', 'name_kana', 'email1', 'phone1', 'do_not_call',
  'postal_code', 'address', 'customer_type', 'owner_id', 'owner_name_raw',
  'gender', 'birthdate', 'first_contact_date', 'registered_at',
  'total_amount', 'total_paid_amount', 'total_used_amount',
  'created_at', 'updated_at',
]);

export interface MemberListResult {
  rows: MemberWithOwner[];
  total: number;
  page: number;
  pageSize: number;
}

const DEFAULT_PAGE_SIZE = 50;

export async function listMembers(params: MemberListParams = {}): Promise<MemberListResult> {
  const supabase = await createClient();
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, params.pageSize ?? DEFAULT_PAGE_SIZE));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // Phase 2: オブジェクト管理機能で動的レンダリングするため全カラム取得 (extra 含む)
  let query = supabase
    .from('members')
    .select(
      `
        *,
        owner:users!members_owner_id_fkey(id, full_name, email)
      `,
      { count: 'exact' },
    )
    .is('deleted_at', null);

  // ソート(ホワイトリスト)→ 既定は登録日時の降順をタイブレークに付与
  if (params.sort && MEMBER_SORTABLE.has(params.sort)) {
    query = query.order(params.sort, {
      ascending: params.dir !== 'desc',
      nullsFirst: false,
    });
  }
  query = query
    .order('registered_at', { ascending: false, nullsFirst: false })
    .range(from, to);

  // q: 部分一致(複数フィールド OR)
  if (params.q && params.q.trim()) {
    const q = params.q.trim().replace(/[%_]/g, '\\$&');
    // PostgREST の or 構文。各 ilike は %q% 形式。
    query = query.or(
      `name.ilike.%${q}%,name_kana.ilike.%${q}%,email1.ilike.%${q}%,phone1.ilike.%${q}%,id.ilike.%${q}%`,
    );
  }

  if (params.ownerId === 'free') {
    query = query.is('owner_id', null);
  } else if (params.ownerId && params.ownerId !== 'all') {
    query = query.eq('owner_id', params.ownerId);
  }

  if (params.customerType) {
    query = query.eq('customer_type', params.customerType);
  }

  const { data, error, count } = await query;
  if (error) {
    throw new Error(`会員一覧取得に失敗: ${error.message}`);
  }

  return {
    rows: (data ?? []) as unknown as MemberWithOwner[],
    total: count ?? 0,
    page,
    pageSize,
  };
}

export async function getMember(id: string): Promise<MemberWithOwner | null> {
  const supabase = await createClient();
  // Phase 2: オブジェクト管理機能で全カラムを動的レンダリングするため `*` で取得
  // ※ extra jsonb も含めて全フィールドを取れるようにする
  const { data, error } = await supabase
    .from('members')
    .select(
      `
        *,
        owner:users!members_owner_id_fkey(id, full_name, email)
      `,
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(`会員取得に失敗: ${error.message}`);
  return (data as unknown as MemberWithOwner) ?? null;
}

export async function getMemberSearchSuggestions(
  q: string,
  limit = 10,
): Promise<Pick<Member, 'id' | 'name' | 'email1' | 'phone1'>[]> {
  const supabase = await createClient();
  const trimmed = q.trim();
  if (!trimmed) return [];
  const safe = trimmed.replace(/[%_]/g, '\\$&');
  const { data, error } = await supabase
    .from('members')
    .select('id, name, email1, phone1')
    .is('deleted_at', null)
    .or(`name.ilike.%${safe}%,name_kana.ilike.%${safe}%,id.ilike.%${safe}%`)
    .limit(limit);
  if (error) throw new Error(`会員検索に失敗: ${error.message}`);
  return (data ?? []) as Pick<Member, 'id' | 'name' | 'email1' | 'phone1'>[];
}
