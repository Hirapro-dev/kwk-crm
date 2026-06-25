import { createClient } from '@/lib/supabase/server';
import { type Bucket, type Granularity, bucketOf, isoToJstYmd } from '@/lib/utils/date_bucket';

/**
 * フォーム集計サマリ (DB: inquiries × forms / 基準日: registered_at 登録日時)。
 *
 * 選択したフォーム(複数可)の問合せを期間・表示粒度ごとに集計する。
 *   - レコード件数: 問合せレコード数
 *   - ユニーク件数: 人単位の重複排除数(複数フォーム横断で1人=1カウント)
 *     人の判定キー: member_id > email > phone > inquiry id の優先順
 */

export interface FormBucketRow extends Bucket {
  count: number;
}

export interface FormSummaryResult {
  recordBuckets: FormBucketRow[];
  uniqueBuckets: FormBucketRow[];
  recordTotal: number;
  uniqueTotal: number;
}

/** フォーム集計のチェックボックスフィルタ */
export interface FormSummaryFilters {
  phoneAcquired: boolean;
  emailOnly: boolean;
  unpaid: boolean;
}

/** 電話番号文字列に数字10桁以上が含まれるか */
function hasPhone(phone: string | null): boolean {
  if (!phone) return false;
  return phone.replace(/\D/g, '').length >= 10;
}

interface InquiryRow {
  id: string;
  member_id: string | null;
  email: string | null;
  phone: string | null;
  registered_at: string;
  member: { total_paid_amount: number | null } | null;
}

/** 人単位のユニークキー(重複排除用) */
function personKey(r: InquiryRow): string {
  if (r.member_id) return `m:${r.member_id}`;
  const email = (r.email ?? '').trim().toLowerCase();
  if (email) return `e:${email}`;
  const phone = (r.phone ?? '').replace(/\D/g, '');
  if (phone) return `p:${phone}`;
  return `i:${r.id}`;
}

export async function getFormSummary(opts: {
  from: string | null;
  to: string | null;
  granularity: Granularity;
  formIds: number[];
  filters: FormSummaryFilters;
}): Promise<FormSummaryResult> {
  const empty: FormSummaryResult = {
    recordBuckets: [],
    uniqueBuckets: [],
    recordTotal: 0,
    uniqueTotal: 0,
  };
  if (opts.formIds.length === 0) return empty;

  const supabase = await createClient();

  const rows: InquiryRow[] = [];
  let fromIdx = 0;
  const PAGE = 1000;
  while (true) {
    let q = supabase
      .from('inquiries')
      .select(
        'id, member_id, email, phone, registered_at, member:members!inquiries_member_id_fkey(total_paid_amount)',
      )
      .is('deleted_at', null)
      .in('form_id', opts.formIds);
    // registered_at(timestamptz)を JST 日付境界で絞り込み
    if (opts.from) q = q.gte('registered_at', `${opts.from}T00:00:00+09:00`);
    if (opts.to) q = q.lte('registered_at', `${opts.to}T23:59:59.999+09:00`);

    const { data, error } = await q.range(fromIdx, fromIdx + PAGE - 1);
    if (error) break;
    if (!data || data.length === 0) break;
    rows.push(...(data as unknown as InquiryRow[]));
    if (data.length < PAGE) break;
    fromIdx += PAGE;
  }

  const { phoneAcquired, emailOnly, unpaid } = opts.filters;

  const recordCounts = new Map<string, FormBucketRow>();
  const uniquePerBucket = new Map<string, Set<string>>();
  const bucketLabel = new Map<string, string>();
  const uniqueGlobal = new Set<string>();
  let recordTotal = 0;

  for (const r of rows) {
    // チェックボックスフィルタ(AND)
    const phone = hasPhone(r.phone);
    if (phoneAcquired && !phone) continue;
    if (emailOnly && phone) continue;
    // 未入金: 会員紐付けがある問合せのみ対象。その会員の累計入金額=0 を判定。
    // 会員未紐付の問合せは除外(skip)する。
    if (unpaid) {
      if (!r.member) continue;
      if (Number(r.member.total_paid_amount ?? 0) !== 0) continue;
    }

    const ymd = isoToJstYmd(r.registered_at);
    const b = bucketOf(ymd, opts.granularity);
    bucketLabel.set(b.key, b.label);

    // レコード件数
    const existing = recordCounts.get(b.key);
    if (existing) existing.count += 1;
    else recordCounts.set(b.key, { ...b, count: 1 });
    recordTotal += 1;

    // ユニーク件数(バケット内 / 全体)
    const pk = personKey(r);
    let set = uniquePerBucket.get(b.key);
    if (!set) {
      set = new Set<string>();
      uniquePerBucket.set(b.key, set);
    }
    set.add(pk);
    uniqueGlobal.add(pk);
  }

  const recordBuckets = [...recordCounts.values()].sort((a, b) => a.key.localeCompare(b.key));
  const uniqueBuckets = [...uniquePerBucket.entries()]
    .map(([key, set]) => ({ key, label: bucketLabel.get(key) ?? key, count: set.size }))
    .sort((a, b) => a.key.localeCompare(b.key));

  return {
    recordBuckets,
    uniqueBuckets,
    recordTotal,
    uniqueTotal: uniqueGlobal.size,
  };
}

/** フォーム候補一覧(コンボボックス用)。 */
export async function listFormsForSummary(): Promise<{ id: number; name: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('forms')
    .select('id, name')
    .order('name', { ascending: true });
  if (error) return [];
  return (data ?? []) as { id: number; name: string }[];
}
