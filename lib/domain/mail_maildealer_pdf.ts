/**
 * メールディーラーから取り出した添付 PDF を、CRM に取り込み済みのメールへ添付として付ける(CLAUDE.md §5.15)。
 * `scripts/mail/attach_maildealer_pdfs.ts` から使う純粋関数。DB・ファイルには触れない。
 *
 * 背景(2026-11-11): メールディーラーの CSV エクスポートには添付が入らないため、過去データ取込
 * (scripts/mail/import_maildealer.ts)ではメール本文だけを入れていた。添付 PDF は画面から 1 件ずつ取り出し、
 * ファイル名を `MD<メールID>-<枝番>_<添付ID>_<ファイル名>.pdf` にして手元に保存してある。
 *
 * 何度実行しても増えないように、保存先のキーに中身のハッシュを入れる(同じ中身 = 同じキー)。
 */

/** 手元のファイル名 `MD<メールID>-<枝番>_<添付ID>_…` から突合キー `<メールID>-<枝番>_<添付ID>` を取り出す */
export function maildealerPdfFileKey(basename: string): string | null {
  const m = /^MD(\d+-\d+)_(\d+)_/.exec(basename);
  return m ? `${m[1]}_${m[2]}` : null;
}

/** 一覧(pdf_index)の行の突合キー。手元のファイル名のキーと同じ形 */
export function maildealerPdfIndexKey(mailId: string, attachmentId: string): string {
  return `${mailId.trim()}_${attachmentId.trim()}`;
}

/** CSV の「メールID」「メールID枝番」から一覧(pdf_index)の mail_id の形 `<メールID>-<枝番>` を作る */
export function maildealerMailKey(mailId: string, branch: string): string {
  return `${(mailId ?? '').trim()}-${(branch ?? '').trim() || '1'}`;
}

/** 添付の保存先のキー。中身のハッシュを入れるので、同じメールに同じ中身を二度保存しない */
export function maildealerPdfStoragePath(
  threadId: string,
  messageRowId: string,
  sha256Hex: string,
  safeName: string,
): string {
  return `${threadId}/${messageRowId}/md-${sha256Hex.slice(0, 16)}_${safeName}`;
}

export type AttachDecision =
  | { action: 'attach' }
  | { action: 'skip'; reason: 'already_attached' | 'same_name_exists' | 'duplicate_in_run' };

/**
 * 1 つの PDF をそのメールに付けるかを決める。
 * - 同じ保存先のキーの行が既にある → 付けない(前回までに付けた分。中身が同じ)
 * - 同じファイル名の添付が、この仕組み以外(SES の受信など)で既にある → 付けない(二重表示を避ける)
 * - 今回の実行で同じメールに同じキーを既に予定している → 付けない(同じメールが別の ID で 2 回ある場合など)
 */
export function decideMaildealerPdf(args: {
  storagePath: string;
  filename: string;
  existing: readonly { filename: string | null; storage_path: string }[];
  plannedPaths: ReadonlySet<string>;
}): AttachDecision {
  const { storagePath, filename, existing, plannedPaths } = args;
  if (existing.some((e) => e.storage_path === storagePath)) {
    return { action: 'skip', reason: 'already_attached' };
  }
  const isOurs = (p: string) => /\/md-[0-9a-f]{16}_/.test(p);
  if (existing.some((e) => !isOurs(e.storage_path) && (e.filename ?? '') === filename)) {
    return { action: 'skip', reason: 'same_name_exists' };
  }
  if (plannedPaths.has(storagePath)) return { action: 'skip', reason: 'duplicate_in_run' };
  return { action: 'attach' };
}
