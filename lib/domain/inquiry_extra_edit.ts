/**
 * 問合せ詳細の編集(CLAUDE.md §8.1 `/inquiries/[id]`)の純粋関数。
 * DB 列のホワイトリストと、可変項目(extra)の差し替え規則。サーバー依存なし。
 */

/** 編集できる DB 列。id / source_mail_message_id / member_match は含めない。会員ID は 2026-09-18 に追加(実在する会員のみ) */
export const EDITABLE_INQUIRY_COLUMNS: ReadonlySet<string> = new Set([
  'form_id',
  'member_id',
  'name',
  'name_kana',
  'email',
  'phone',
  'postal_code',
  'address',
  'ad_id',
  'registered_at',
]);

/**
 * 現在の extra に、許可キー(項目管理で定義済みの可変項目)の編集内容だけを差し込む。
 * 値は前後の空白を除き、空文字なら削除。許可キー以外の編集は無視し、他のキー(備考など)はそのまま残す。
 */
export function mergeInquiryExtra(
  current: Record<string, unknown> | null | undefined,
  edits: Record<string, string | null | undefined>,
  allowedKeys: ReadonlySet<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(current ?? {}) };
  for (const [key, raw] of Object.entries(edits)) {
    if (!allowedKeys.has(key)) continue;
    const value = (raw ?? '').trim();
    if (value === '') delete out[key];
    else out[key] = value;
  }
  return out;
}
