/**
 * 会員の extra(jsonb)のうち、会員詳細の編集ダイアログから編集を許可するキー(CLAUDE.md §5.4)。
 *
 * 電話番号2・3 は DB カラム(phone1)ではなく extra のキーとして CSV から取り込まれており、
 * 詳細画面には出るのに編集できなかった。extra には累計入金額・各案件利用額など CSV 取込で
 * 管理する項目も入っているため、画面から編集できるキーはここで明示的に絞る。
 * 純粋関数のみ(サーバー依存なし。クライアント部品からも import できる)。
 */

export const EDITABLE_MEMBER_EXTRA_KEYS: readonly string[] = ['電話番号2', '電話番号3'];

/**
 * 現在の extra に、許可キーの編集内容だけを差し込んだ新しいオブジェクトを返す。
 * - 許可キー以外の編集は無視する(画面から任意のキーを送られても書き込まない)
 * - 値は前後の空白を除き、空文字/null/undefined ならそのキーを削除する(空文字を残さない)
 * - 他のキーはそのまま残す
 */
export function mergeMemberExtra(
  current: Record<string, unknown> | null | undefined,
  edits: Record<string, string | null | undefined>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(current ?? {}) };
  for (const key of EDITABLE_MEMBER_EXTRA_KEYS) {
    if (!(key in edits)) continue;
    const value = (edits[key] ?? '').trim();
    if (value === '') delete out[key];
    else out[key] = value;
  }
  return out;
}
