import { RECENT_AD_PICK_DAYS, splitRecentAds } from '@/lib/domain/ad_recent_picks';
import { describe, expect, it } from 'vitest';

// 意図: 広告マスタの【取得】で、直近 1 か月に(誰かが)選んだ広告を上にまとめて出す(2026-10-27)。
// 選んだ記録は ad_master_picks に 1 回 1 行で残るので、同じ広告は最後に選ばれた日時で 1 つにまとめる。
const ad = (id: string) => ({ id, ad_type: 'KAWARA版', name: `広告${id}` });
const now = new Date('2026-10-27T03:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

describe('splitRecentAds', () => {
  it('直近に選ばれた順で「最近選んだ広告」に出し、残りは元の並びのまま下に出す', () => {
    const rows = [ad('N1'), ad('N2'), ad('N3'), ad('N4')];
    const picks = [
      { ad_id: 'N3', picked_at: daysAgo(1) },
      { ad_id: 'N1', picked_at: daysAgo(5) },
    ];
    const r = splitRecentAds(rows, picks, now);
    expect(r.recent.map((a) => a.id)).toEqual(['N3', 'N1']);
    expect(r.others.map((a) => a.id)).toEqual(['N2', 'N4']);
  });

  it('同じ広告が何回選ばれても 1 つにまとめ、いちばん最近選ばれた日時で並べる', () => {
    const rows = [ad('N1'), ad('N2')];
    const picks = [
      { ad_id: 'N1', picked_at: daysAgo(10) },
      { ad_id: 'N2', picked_at: daysAgo(3) },
      { ad_id: 'N1', picked_at: daysAgo(1) },
    ];
    expect(splitRecentAds(rows, picks, now).recent.map((a) => a.id)).toEqual(['N1', 'N2']);
  });

  it(`${RECENT_AD_PICK_DAYS} 日より前に選ばれただけの広告は「最近」に入れない`, () => {
    const rows = [ad('N1'), ad('N2')];
    const picks = [
      { ad_id: 'N1', picked_at: daysAgo(RECENT_AD_PICK_DAYS + 1) },
      { ad_id: 'N2', picked_at: daysAgo(RECENT_AD_PICK_DAYS - 1) },
    ];
    const r = splitRecentAds(rows, picks, now);
    expect(r.recent.map((a) => a.id)).toEqual(['N2']);
    expect(r.others.map((a) => a.id)).toEqual(['N1']);
  });

  it('検索・種別の絞り込みで一覧に無い広告(無効化された広告など)は、選ばれていても出さない', () => {
    const r = splitRecentAds([ad('N1')], [{ ad_id: 'N9', picked_at: daysAgo(1) }], now);
    expect(r.recent).toEqual([]);
    expect(r.others.map((a) => a.id)).toEqual(['N1']);
  });

  it('選んだ記録が無ければ、すべて元の並びのまま', () => {
    const r = splitRecentAds([ad('N1'), ad('N2')], [], now);
    expect(r.recent).toEqual([]);
    expect(r.others.map((a) => a.id)).toEqual(['N1', 'N2']);
  });
});
