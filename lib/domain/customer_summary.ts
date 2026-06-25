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
 * points 指定時は info_acquired_points がいずれかに一致する会員のみ対象。
 */

export interface CustomerSummaryFilters {
  phoneAcquired: boolean;
  emailOnly: boolean;
  unpaid: boolean;
  /** 個人情報取得ポイントの絞り込み(空なら全件) */
  points: string[];
}

export interface CustomerBucketRow extends Bucket {
  count: number;
}

/** 会員氏名軸の明細1行 */
export interface CustomerMemberRow {
  id: string;
  name: string | null;
  info_acquired_date: string;
  info_acquired_points: string | null;
}

/** 個人情報取得ポイント軸の集計1行 */
export interface PointBreakdownRow {
  point: string;
  count: number;
}

export interface CustomerSummaryResult {
  buckets: CustomerBucketRow[];
  total: number;
  /** 会員氏名軸の明細(上限あり) */
  members: CustomerMemberRow[];
  /** 会員氏名軸が上限で打ち切られたか */
  membersTruncated: boolean;
  /** 個人情報取得ポイント軸の集計 */
  pointBreakdown: PointBreakdownRow[];
}

/** 会員氏名軸の最大表示件数 */
const MEMBERS_LIMIT = 1000;
const NO_POINT_LABEL = '(未設定)';

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
    id: string;
    name: string | null;
    phone1: string | null;
    total_paid_amount: number | null;
    info_acquired_date: string;
    info_acquired_points: string | null;
  }[] = [];
  let fromIdx = 0;
  const PAGE = 1000;
  while (true) {
    let q = supabase
      .from('members')
      .select('id, name, phone1, total_paid_amount, info_acquired_date, info_acquired_points')
      .is('deleted_at', null)
      .not('info_acquired_date', 'is', null);
    if (opts.from) q = q.gte('info_acquired_date', opts.from);
    if (opts.to) q = q.lte('info_acquired_date', opts.to);
    if (opts.filters.points.length > 0) q = q.in('info_acquired_points', opts.filters.points);

    const { data, error } = await q.range(fromIdx, fromIdx + PAGE - 1);
    if (error) break;
    if (!data || data.length === 0) break;
    rows.push(...(data as typeof rows));
    if (data.length < PAGE) break;
    fromIdx += PAGE;
  }

  const { phoneAcquired, emailOnly, unpaid } = opts.filters;

  const counts = new Map<string, CustomerBucketRow>();
  const pointCounts = new Map<string, number>();
  const members: CustomerMemberRow[] = [];
  let total = 0;
  let membersTruncated = false;

  for (const r of rows) {
    const phone = hasPhone(r.phone1);
    if (phoneAcquired && !phone) continue;
    if (emailOnly && phone) continue;
    if (unpaid && Number(r.total_paid_amount ?? 0) !== 0) continue;

    // 時間バケット
    const b = bucketOf(r.info_acquired_date, opts.granularity);
    const existing = counts.get(b.key);
    if (existing) existing.count += 1;
    else counts.set(b.key, { ...b, count: 1 });

    // 取得ポイント軸
    const pt = r.info_acquired_points?.trim() || NO_POINT_LABEL;
    pointCounts.set(pt, (pointCounts.get(pt) ?? 0) + 1);

    // 会員氏名軸(上限まで)
    if (members.length < MEMBERS_LIMIT) {
      members.push({
        id: r.id,
        name: r.name,
        info_acquired_date: r.info_acquired_date,
        info_acquired_points: r.info_acquired_points,
      });
    } else {
      membersTruncated = true;
    }

    total += 1;
  }

  const buckets = [...counts.values()].sort((a, b) => a.key.localeCompare(b.key));
  const pointBreakdown = [...pointCounts.entries()]
    .map(([point, count]) => ({ point, count }))
    .sort((a, b) => b.count - a.count);
  // 会員氏名軸は取得日の新しい順
  members.sort((a, b) => b.info_acquired_date.localeCompare(a.info_acquired_date));

  return { buckets, total, members, membersTruncated, pointBreakdown };
}

/**
 * 個人情報取得ポイントのユニーク値一覧(コンボボックス候補)。
 * info_acquired_points が非NULLの会員から重複を除いて返す。
 */
export async function listInfoAcquiredPoints(): Promise<string[]> {
  const supabase = await createClient();
  const set = new Set<string>();
  let fromIdx = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('members')
      .select('info_acquired_points')
      .is('deleted_at', null)
      .not('info_acquired_points', 'is', null)
      .order('info_acquired_points', { ascending: true })
      .range(fromIdx, fromIdx + PAGE - 1);
    if (error) break;
    if (!data || data.length === 0) break;
    for (const r of data) {
      const v = (r.info_acquired_points as string | null)?.trim();
      if (v) set.add(v);
    }
    if (data.length < PAGE) break;
    fromIdx += PAGE;
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'ja'));
}
