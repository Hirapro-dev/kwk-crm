/**
 * メーラーの「取込候補」判定(CLAUDE.md §5.15 / migration 82)。
 *
 * 旧 Salesforce の「メール to リード」用アドレスを宛先(To/Cc)に含むメール
 * (フォーム通知など)は、リード/問合せとして取り込むべき候補。受信 Webhook が
 * この純粋関数で判定し、スレッドの is_import_candidate に保存する。
 * サーバー依存を持たない(テスト・クライアント部品からも import できる)。
 */

import { MAIL_IMPORT_CANDIDATE_ADDRESSES } from './mail_types';

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * To/Cc のいずれかに判定アドレスが(完全一致で)含まれていれば true。
 * 大文字小文字・前後の空白は無視する。部分一致はしない。
 */
export function isImportCandidate(
  toAddresses: readonly string[],
  ccAddresses: readonly string[],
  candidateAddresses: readonly string[] = MAIL_IMPORT_CANDIDATE_ADDRESSES,
): boolean {
  const targets = new Set(candidateAddresses.map(normalizeAddress));
  if (targets.size === 0) return false;
  for (const a of toAddresses) if (targets.has(normalizeAddress(a))) return true;
  for (const a of ccAddresses) if (targets.has(normalizeAddress(a))) return true;
  return false;
}
