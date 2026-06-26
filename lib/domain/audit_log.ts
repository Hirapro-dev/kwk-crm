import { createClient } from '@/lib/supabase/server';

/**
 * 監査ログ(audit_logs)の取得・表示ヘルパー (CLAUDE.md §5.12)
 *
 * DBトリガーが記録した「誰がいつ何を作成/編集/削除したか」を admin が閲覧する。
 * RLS により admin のみ SELECT 可能なため、通常の(ユーザー)クライアントで取得する。
 */

export type AuditAction = 'INSERT' | 'UPDATE' | 'DELETE';

export interface AuditChange {
  old: unknown;
  new: unknown;
}

export interface AuditLogRow {
  id: number;
  actor_id: string | null;
  actor_name: string | null;
  action: AuditAction;
  table_name: string;
  record_id: string | null;
  changes: Record<string, AuditChange> | null;
  created_at: string;
}

export interface AuditLogFilter {
  tableName?: string;
  actorId?: string;
  action?: AuditAction;
  from?: string;
  to?: string;
  limit?: number;
}

/** 対象テーブルの日本語ラベル */
export const TABLE_LABEL: Record<string, string> = {
  members: '会員',
  applications: '申込',
  activities: '対応歴',
  users: 'ユーザー',
};

/** カラム名 → 日本語ラベル(主要カラムのみ。未定義はカラム名のまま表示) */
const FIELD_LABEL: Record<string, string> = {
  name: '氏名',
  name_kana: 'かな',
  real_name: '実名義',
  email: 'メール',
  email1: 'メール1',
  email2: 'メール2',
  email3: 'メール3',
  phone1: '電話',
  do_not_call: '架電NG',
  address: '住所',
  postal_code: '郵便番号',
  customer_type: '顧客種別',
  owner_id: '担当',
  owner_name_raw: '担当(原文)',
  total_amount: '総取引額',
  total_paid_amount: '総入金額',
  total_used_amount: '総利用額',
  status: 'ステータス',
  flow_type: '入金/移動',
  project_id: '案件',
  application_date: '申込日',
  payment_amount: '入金額',
  payment_date: '入金日',
  scheduled_amount: '入金予定額',
  scheduled_payment_date: '入金予定日',
  withdrawal_amount: '出金額',
  withdrawal_date: '出金日',
  acquirer_id: '獲得者',
  d_bunrui: '大分類',
  m_bunrui: '中分類',
  s_bunrui: '小分類',
  description: 'コメント',
  duration_minutes: '所要時間',
  registered_datetime: '対応日時',
  registered_date: '対応日',
  role: 'ロール',
  is_active: '有効',
  full_name: '氏名',
  first_name: '名',
  last_name: '姓',
  deleted_at: '削除',
  extra: '拡張項目',
};

export function fieldLabel(col: string): string {
  return FIELD_LABEL[col] ?? col;
}

/** 操作の表示ラベル。論理削除(deleted_at を立てるUPDATE)は「削除」、復元は「復元」と判定。 */
export function displayAction(row: AuditLogRow): '作成' | '編集' | '削除' | '復元' {
  if (row.action === 'INSERT') return '作成';
  if (row.action === 'DELETE') return '削除';
  const del = row.changes?.deleted_at;
  if (del) {
    if (del.new != null && del.old == null) return '削除';
    if (del.new == null && del.old != null) return '復元';
  }
  return '編集';
}

export async function listAuditLog(f: AuditLogFilter = {}): Promise<AuditLogRow[]> {
  try {
    const supabase = await createClient();
    let q = supabase
      .from('audit_logs')
      .select('id, actor_id, actor_name, action, table_name, record_id, changes, created_at')
      .order('created_at', { ascending: false })
      .limit(f.limit ?? 300);
    if (f.tableName) q = q.eq('table_name', f.tableName);
    if (f.actorId) q = q.eq('actor_id', f.actorId);
    if (f.action) q = q.eq('action', f.action);
    if (f.from) q = q.gte('created_at', f.from);
    if (f.to) q = q.lte('created_at', f.to);
    const { data, error } = await q;
    if (error || !data) return [];
    return data as unknown as AuditLogRow[];
  } catch {
    return [];
  }
}

/** フィルタ用: 担当者選択肢(有効ユーザー) */
export async function listAuditActorOptions(): Promise<{ id: string; name: string }[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from('users')
      .select('id, full_name, email')
      .is('deleted_at', null)
      .order('full_name', { ascending: true });
    return (
      (data ?? []) as unknown as { id: string; full_name: string | null; email: string }[]
    ).map((u) => ({ id: u.id, name: u.full_name ?? u.email }));
  } catch {
    return [];
  }
}
