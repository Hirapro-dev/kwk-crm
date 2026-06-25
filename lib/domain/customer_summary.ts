import { createClient } from '@/lib/supabase/server';
import { type Bucket, type Granularity, bucketOf } from '@/lib/utils/date_bucket';

/**
 * 新規顧客取得サマリ (DB: members / 基準日: info_acquired_date 個人情報取得日)。
 *
 * 期間内に個人情報を取得した会員数を、表示粒度ごとに集計する。
 * フィルタ(チェックボックス):
 *   - phoneAcquired: 電話番号取得済み(数字10桁以上)
 *   - emailOnly: メアドのみ(電話番号が数字10桁未満)
 *   - unpaid: 未入金(累計入金額=0)
 * いずれも AND で適用する。
 */

export interface CustomerSummaryFilters {
  phoneAcquired: boolean;
  emailOnly: boolean;
  unpaid: boolean;
}

export interface CustomerBucketRow extends Bucket {
  count: number;
}

export interface CustomerSummaryResult {
  buckets: CustomerBucketRow[];
  total: number;
}

/** 電話番号文字列に数字10桁以上が含まれるか(=電話番号取得済み判定) */
function hasPhone(phone: string | null): boolean {
  if (!phone) return false;
  return phone.replace(/\D/g, '').length >= 10;
}

export async function getNewCustomerSummary(opts: {
  from: string | null;
  to: string | null;
  granularity: Granularity;
  filters: CustomerSummaryFilters;
}): Promise<CustomerSummaryResult> {
  const supabase = await createClient();

  // 基準日(個人情報取得日)が入っている会員のみ対象にページング取得
  const rows: {
    phone1: string | null;
    total_paid_amount: number | null;
    info_acquired_date: string;
  }[] = [];
  let fromIdx = 0;
  const PAGE = 1000;
  while (true) {
    let q = supabase
      .from('members')
      .select('phone1, total_paid_amount, info_acquired_date')
      .is('deleted_at', null)
      .not('info_acquired_date', 'is', null);
    if (opts.from) q = q.gte('info_acquired_date', opts.from);
    if (opts.to) q = q.lte('info_acquired_date', opts.to);

    const { data, error } = await q.range(fromIdx, fromIdx + PAGE - 1);
    if (error) break;
    if (!data || data.length === 0) break;
    rows.push(...(data as typeof rows));
    if (data.length < PAGE) break;
    fromIdx += PAGE;
  }

  const { phoneAcquired, emailOnly, unpaid } = opts.filters;

  const counts = new Map<string, CustomerBucketRow>();
  let total = 0;
  for (const r of rows) {
    const phone = hasPhone(r.phone1);
    if (phoneAcquired && !phone) continue;
    if (emailOnly && phone) continue;
    if (unpaid && Number(r.total_paid_amount ?? 0) !== 0) continue;

    const b = bucketOf(r.info_acquired_date, opts.granularity);
    const existing = counts.get(b.key);
    if (existing) existing.count += 1;
    else counts.set(b.key, { ...b, count: 1 });
    total += 1;
  }

  const buckets = [...counts.values()].sort((a, b) => a.key.localeCompare(b.key));
  return { buckets, total };
}
