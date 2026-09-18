/**
 * メーラーの署名(署名マスタ)の純粋関数。CLAUDE.md §5.15「署名」。
 * 返信・新規作成フォーム(クライアント)と Server Action の両方から使う。DB には触らない。
 *
 *   - 送信元の受信箱の「既定の署名」からフォームの選択値を決める
 *   - 署名名・本文の正規化(上限・改行コード)
 */

export interface SignatureOption {
  id: number;
  name: string;
  body: string;
  is_active: boolean;
}

/** 署名本文の上限(誤って巨大なテキストを保存しないための安全弁) */
export const MAX_SIGNATURE_BODY_CHARS = 2_000;
/** 署名名の上限 */
export const MAX_SIGNATURE_NAME_CHARS = 80;

/**
 * 送信元の受信箱に設定された既定の署名 ID から、フォームの署名セレクトの値('' = 署名なし)を決める。
 * 既定が未設定・存在しない・無効化済みなら '' (無効な署名を黙って付けない)。
 */
export function defaultSignatureValue(
  defaultSignatureId: number | null | undefined,
  signatures: readonly SignatureOption[],
): string {
  if (defaultSignatureId == null) return '';
  const s = signatures.find((x) => x.id === defaultSignatureId);
  return s?.is_active ? String(s.id) : '';
}

/** 選択値('' or id 文字列)に対応する署名本文。無ければ '' */
export function signatureBodyOf(value: string, signatures: readonly SignatureOption[]): string {
  if (!value) return '';
  return signatures.find((s) => String(s.id) === value)?.body ?? '';
}

/** 署名本文の正規化: CRLF → LF、前後の空白を除き、空なら null。上限で切る */
export function normalizeSignatureBody(input: string | null | undefined): string | null {
  const s = (input ?? '').replace(/\r\n/g, '\n').trim();
  if (!s) return null;
  return s.slice(0, MAX_SIGNATURE_BODY_CHARS);
}

/** 署名名の正規化: 前後の空白を除き、空なら null。上限で切る */
export function normalizeSignatureName(input: string | null | undefined): string | null {
  const s = (input ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.slice(0, MAX_SIGNATURE_NAME_CHARS);
}
