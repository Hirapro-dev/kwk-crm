/**
 * メーラーの検索(CLAUDE.md §5.15「検索」/ migration 125)の決定論的ロジック。純粋関数のみ。
 *
 * - 入力にメールアドレスが入っていれば「アドレス検索」(差出人 / 宛先 / CC のどれかに一致するメールのスレッドを、全受信箱から)
 * - それ以外は「テキスト検索」(件名・差出人名の部分一致。1〜2 文字は件名だけ。本文は対象外。migration 126)
 * - DB(search_mail_threads)は一致したスレッドを新しい順に最大 MAIL_SEARCH_LIMIT 件返す。状態タブ・受信箱・担当・未読の絞り込みと
 *   タブごとの件数はここで行う(1 回の検索結果を一覧・件数・前後移動で使い回すため)
 */

export const MAIL_SEARCH_LIMIT = 1000;

export type MailSearchMode = 'address' | 'text';

export interface ParsedMailSearch {
  mode: MailSearchMode;
  term: string;
}

const ADDRESS_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

/**
 * 検索語を解釈する。空なら null。
 * 「氏名 <user@example.com>」「<user@example.com>」のような書き方もアドレスとして扱う(コピーして貼ることが多いため)。
 */
export function parseMailSearch(input: string | null | undefined): ParsedMailSearch | null {
  const raw = (input ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  const bracket = raw.match(/<([^<>]+)>\s*$/);
  const candidate = (bracket ? bracket[1] : raw)?.trim() ?? '';
  if (ADDRESS_RE.test(candidate)) return { mode: 'address', term: candidate.toLowerCase() };
  return { mode: 'text', term: raw.slice(0, 200) };
}

/** search_mail_threads が返す 1 行 */
export interface MailSearchHit {
  id: string;
  mail_box_id: number;
  status: string;
  category: string;
  assignee_id: string | null;
  is_read: boolean;
  is_import_candidate: boolean;
  last_message_at: string | null;
}

/** 一覧と同じ絞り込み条件(lib/domain/mail.ts の applyThreadFilters と同じ意味) */
export interface MailSearchFilter {
  /** 配列ならどれかに一致(「対応中」タブ = 対応中 + 承認待ち) */
  status?: string | readonly string[];
  category?: string;
  /** users.id / 'none' = 未割当 */
  assigneeId?: string;
  mailBoxId?: number;
  mailBoxIds?: number[];
  unreadOnly?: boolean;
  importCandidate?: boolean;
}

export function filterMailSearchHits(
  hits: readonly MailSearchHit[],
  f: MailSearchFilter,
): MailSearchHit[] {
  return hits.filter((h) => {
    if (typeof f.status === 'string' && h.status !== f.status) return false;
    if (Array.isArray(f.status) && !f.status.includes(h.status)) return false;
    if (f.category && h.category !== f.category) return false;
    if (f.assigneeId === 'none' && h.assignee_id !== null) return false;
    if (f.assigneeId && f.assigneeId !== 'none' && h.assignee_id !== f.assigneeId) return false;
    if (f.mailBoxId && h.mail_box_id !== f.mailBoxId) return false;
    if (f.mailBoxIds && !f.mailBoxIds.includes(h.mail_box_id)) return false;
    if (f.unreadOnly && h.is_read) return false;
    if (f.importCandidate && !h.is_import_candidate) return false;
    return true;
  });
}

/** 一覧の並び(last_message_at desc, id desc)で、指定スレッドの前(新しい側)と次(古い側) */
export function adjacentInHits(
  hits: readonly MailSearchHit[],
  threadId: string,
): { prevId: string | null; nextId: string | null } {
  const i = hits.findIndex((h) => h.id === threadId);
  if (i < 0) return { prevId: null, nextId: null };
  return { prevId: hits[i - 1]?.id ?? null, nextId: hits[i + 1]?.id ?? null };
}

/** 検索結果の案内(件数の上限に達したときは絞り込みを促す) */
export function mailSearchNote(parsed: ParsedMailSearch, hitCount: number): string {
  const what =
    parsed.mode === 'address'
      ? `「${parsed.term}」が差出人・宛先・CC に入っているメール(すべての送信元)`
      : [...parsed.term].length >= 3
        ? `「${parsed.term}」を件名・差出人名に含むメール`
        : `「${parsed.term}」を件名に含むメール(2 文字以下は件名だけを検索します)`;
  return hitCount >= MAIL_SEARCH_LIMIT
    ? `${what}のうち新しい ${MAIL_SEARCH_LIMIT.toLocaleString()} スレッドを表示しています。言葉を足して絞り込んでください。`
    : `${what}を表示しています。`;
}
