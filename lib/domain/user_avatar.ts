/**
 * ユーザーのプロフィール画像(アイコン)の純粋関数。CLAUDE.md §5.1 / §8.1(migration 114)。
 * 画面(client)と Server Action の両方から使う。DB・Storage には触らない。
 */

/** 受け付ける画像の種類(拡張子はキーに使う) */
export const AVATAR_TYPES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
/** アップロードの上限(画面側で 256px 四方に縮小してから送るので通常は数十 KB) */
export const AVATAR_MAX_BYTES = 1_000_000;
/** 画面側で縮小する一辺のピクセル数 */
export const AVATAR_SIZE_PX = 256;

/** 公開バケット user-avatars の URL。path が無ければ null(頭文字の丸を出す) */
export function avatarPublicUrl(
  supabaseUrl: string | undefined,
  path: string | null | undefined,
): string | null {
  if (!supabaseUrl || !path) return null;
  const base = supabaseUrl.replace(/\/+$/, '');
  return `${base}/storage/v1/object/public/user-avatars/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** 頭文字(氏名の先頭 1 文字。無ければメールの先頭を大文字で) */
export function avatarInitial(fullName: string | null | undefined, email?: string | null): string {
  const n = (fullName ?? '').trim();
  if (n) return n.charAt(0);
  const e = (email ?? '').trim();
  return e ? e.charAt(0).toUpperCase() : '?';
}

/** Storage のキー。<userId>/<時刻>.<拡張子>(古い画像とは別のキーにしてキャッシュの取り違えを防ぐ) */
export function avatarObjectKey(userId: string, mimeType: string, now = Date.now()): string | null {
  const ext = AVATAR_TYPES[mimeType];
  if (!ext) return null;
  return `${userId}/${now}.${ext}`;
}
