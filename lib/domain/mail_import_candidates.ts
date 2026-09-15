/**
 * メーラーの「取込候補」判定(CLAUDE.md §5.15 / migration 82, 89)。
 *
 * 旧 Salesforce の「メール to リード」用アドレスを宛先(To/Cc)に含むメール
 * (フォーム通知など)は、リード/問合せとして取り込むべき候補。加えて、判定アドレス宛に
 * 来ないフォーム通知(エキスパのフォーム登録通知など)は件名のキーワードで拾う。
 * 受信 Webhook がこの純粋関数で判定し、スレッドの is_import_candidate に保存する。
 * サーバー依存を持たない(テスト・クライアント部品からも import できる)。
 */

import {
  MAIL_IMPORT_CANDIDATE_ADDRESSES,
  MAIL_IMPORT_CANDIDATE_SUBJECT_KEYWORDS,
} from './mail_types';

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * 次のいずれかなら true。
 * - To/Cc のいずれかに判定アドレスが(完全一致で)含まれる。大文字小文字・前後の空白は無視。部分一致はしない
 * - 件名に判定キーワードのいずれかが含まれる(部分一致。大文字小文字は区別しない)
 */
export function isImportCandidate(
  toAddresses: readonly string[],
  ccAddresses: readonly string[],
  candidateAddresses: readonly string[] = MAIL_IMPORT_CANDIDATE_ADDRESSES,
  subject: string | null | undefined = null,
  subjectKeywords: readonly string[] = MAIL_IMPORT_CANDIDATE_SUBJECT_KEYWORDS,
): boolean {
  const targets = new Set(candidateAddresses.map(normalizeAddress));
  if (targets.size > 0) {
    for (const a of toAddresses) if (targets.has(normalizeAddress(a))) return true;
    for (const a of ccAddresses) if (targets.has(normalizeAddress(a))) return true;
  }
  const s = (subject ?? '').toLowerCase();
  if (s) {
    for (const k of subjectKeywords) {
      const kw = k.trim().toLowerCase();
      if (kw && s.includes(kw)) return true;
    }
  }
  return false;
}
