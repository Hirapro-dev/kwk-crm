/**
 * メーラーの「送信済み」「自分の送信履歴」(CLAUDE.md §5.15「送信済み・自分の送信履歴」。2026-10-28 ユーザー要望)の純粋関数。
 * 送信メールは 1 通ずつ新しい順に並べ、「次の 50 件」は送信日時と ID の続き位置(カーソル)で読む
 * (約 22 万通あり、件数を数えたりページ番号で飛ばしたりすると重いため)。
 */

/** 1 回に出す件数 */
export const SENT_PAGE_SIZE = 50;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 続き位置の文字列(URL の ?before=)。「送信日時(ISO)_ID」 */
export function sentCursorOf(row: { sent_at: string; id: string }): string {
  return `${new Date(row.sent_at).toISOString()}_${row.id}`;
}

/** URL の続き位置を読む。形が違えば null(先頭から読む) */
export function parseSentCursor(
  raw: string | null | undefined,
): { sentAt: string; id: string } | null {
  const s = (raw ?? '').trim();
  const i = s.lastIndexOf('_');
  if (i <= 0) return null;
  const at = s.slice(0, i);
  const id = s.slice(i + 1);
  if (!UUID_RE.test(id) || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(at)) return null;
  const t = Date.parse(at);
  if (Number.isNaN(t)) return null;
  return { sentAt: new Date(t).toISOString(), id: id.toLowerCase() };
}

/** 「送信済み」「自分の送信履歴」の URL */
export function sentFolderHref(opts: { mine: boolean; before?: string }): string {
  const p = new URLSearchParams();
  if (opts.mine) p.set('mine', '1');
  if (opts.before) p.set('before', opts.before);
  const q = p.toString();
  return q ? `/mail/sent?${q}` : '/mail/sent';
}
