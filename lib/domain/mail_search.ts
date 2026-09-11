/**
 * メーラーのヘッダー検索の決定論的ロジック(CLAUDE.md §5.15 / §0.1 R6)。
 * lib/domain/mail.ts(DB アクセス層)から使う純粋関数。DB には触れない。
 */

/** 入力文字列が何を指しているかの判定結果 */
export type MailSearchKind = 'member_id' | 'email' | 'keyword';

export interface MailSearchQuery {
  kind: MailSearchKind;
  value: string;
}

/** 実際の会員ID(members.id)の桁数。"K-" + 9桁ゼロ埋め(CLAUDE.md §3.1) */
const MEMBER_ID_DIGITS = 9;

/**
 * 検索語を「会員ID」「メールアドレス」「キーワード」に分類する。
 *   - 会員ID: "K"(大文字小文字問わず)+ 任意のハイフン + 1〜9桁の数字。
 *     実際の会員IDは常に9桁ゼロ埋めのため、桁が足りない入力は前ゼロを補って
 *     完全一致させる(あいまい一致はしない。§5.15 の会員突合と同じ方針)。
 *   - メールアドレス: "@" を含む
 *   - それ以外: キーワード(件名・本文を対象に部分一致)
 * 空・空白のみは null(検索条件なし)。
 */
export function classifyMailSearchQuery(raw: string | null | undefined): MailSearchQuery | null {
  const q = (raw ?? '').trim();
  if (!q) return null;
  const m = q.match(/^k-?\s*(\d{1,9})$/i);
  if (m) {
    return { kind: 'member_id', value: `K-${(m[1] ?? '').padStart(MEMBER_ID_DIGITS, '0')}` };
  }
  if (q.includes('@')) return { kind: 'email', value: q.toLowerCase() };
  return { kind: 'keyword', value: q };
}

/** SQL の LIKE/ILIKE パターンに埋め込む前に、% と _ をエスケープする(ワイルドカード注入を防ぐ) */
export function escapeLikeWildcards(raw: string): string {
  return raw.replace(/[%_]/g, '\\$&');
}

/**
 * `<input type="date">` の "YYYY-MM-DD"(利用者は日本時間のつもりで入力する)を、
 * その日の開始・終了の日本時間を表す UTC の ISO 文字列にする。
 * 例: "2026-09-11" → from: 2026-09-10T15:00:00.000Z(=JST 9/11 00:00:00)
 *                    to  : 2026-09-11T14:59:59.999Z(=JST 9/11 23:59:59.999)
 * 形式が不正な入力は無視する(未指定として扱う。黙って別の日付にしない)。
 */
export function jstDateRangeToUtcIso(
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined,
): { fromIso?: string; toIso?: string } {
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const out: { fromIso?: string; toIso?: string } = {};
  if (dateFrom && DATE_RE.test(dateFrom)) {
    const d = new Date(`${dateFrom}T00:00:00.000+09:00`);
    if (!Number.isNaN(d.getTime())) out.fromIso = d.toISOString();
  }
  if (dateTo && DATE_RE.test(dateTo)) {
    const d = new Date(`${dateTo}T23:59:59.999+09:00`);
    if (!Number.isNaN(d.getTime())) out.toIso = d.toISOString();
  }
  return out;
}
