/**
 * 広告マスタの【取得】で「最近選んだ広告」を上にまとめる(CLAUDE.md §5.18。2026-10-27)。
 *
 * 選んだ記録(ad_master_picks。全員分)のうち直近 RECENT_AD_PICK_DAYS 日のものを、広告ごとに
 * いちばん最近選ばれた日時で 1 つにまとめ、新しい順に「最近」へ。残りは元の並びのまま「その他」へ。
 * 一覧(検索・種別で絞った結果)に無い広告は、選ばれていても出さない。
 */

export const RECENT_AD_PICK_DAYS = 30;

export interface AdPick {
  ad_id: string;
  picked_at: string;
}

export function splitRecentAds<T extends { id: string }>(
  rows: readonly T[],
  picks: readonly AdPick[],
  now: Date = new Date(),
): { recent: T[]; others: T[] } {
  const since = now.getTime() - RECENT_AD_PICK_DAYS * 86_400_000;
  const lastPicked = new Map<string, number>();
  for (const p of picks) {
    const t = Date.parse(p.picked_at);
    if (Number.isNaN(t) || t < since) continue;
    if (t > (lastPicked.get(p.ad_id) ?? Number.NEGATIVE_INFINITY)) lastPicked.set(p.ad_id, t);
  }
  const recent = rows
    .filter((r) => lastPicked.has(r.id))
    .sort((a, b) => (lastPicked.get(b.id) ?? 0) - (lastPicked.get(a.id) ?? 0));
  const others = rows.filter((r) => !lastPicked.has(r.id));
  return { recent, others };
}
