/**
 * 送信元ドメインの SES 検証状態の判定に使う純粋関数(CLAUDE.md §5.15)。SES とのやり取りは lib/mail/ses_send.ts。
 *
 * 2026-10-23: 返信・新規作成の画面を開くたびに、受信箱(約 660 件)ごとに SES へ問い合わせていたため、
 * 同時に大量の問い合わせが出て SES に断られ(スロットリング)、検証済みのドメインまで「受信専用」と表示されていた。
 */

/** SES の ListEmailIdentities の 1 件(必要な項目だけ) */
export interface SesIdentitySummary {
  IdentityName?: string;
  IdentityType?: string;
  VerificationStatus?: string;
  SendingEnabled?: boolean;
}

/** ID 一覧から、送信できるドメイン(検証成功・送信が止められていない)を小文字で返す */
export function verifiedDomainsFromIdentities(items: readonly SesIdentitySummary[]): Set<string> {
  const out = new Set<string>();
  for (const it of items) {
    if (it.IdentityType !== 'DOMAIN' || !it.IdentityName) continue;
    if (it.VerificationStatus !== 'SUCCESS' || it.SendingEnabled === false) continue;
    out.add(it.IdentityName.trim().toLowerCase());
  }
  return out;
}

/** SES に回数制限で断られたか(やり直す対象) */
export function isSesThrottle(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name ?? '';
  return name === 'TooManyRequestsException' || name === 'ThrottlingException';
}

/** 同時に動かす数を limit までに絞って、すべての要素を処理する(結果は入力の順) */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
