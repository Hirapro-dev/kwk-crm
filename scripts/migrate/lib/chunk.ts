/**
 * 移行スクリプト共通: チャンク処理ヘルパ
 * 仕様書 §3 Phase 3: 活動履歴120万件を5万件ずつ COPY 投入する想定
 */

export function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) throw new Error('chunk size must be > 0');
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

/**
 * 非同期処理を順次実行(並列度1)。
 * Supabase の rate limit を考慮し、移行スクリプトでは並列実行を避ける。
 */
export async function forEachSeq<T, R>(
  items: T[],
  handler: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i++) {
    results.push(await handler(items[i]!, i));
  }
  return results;
}
