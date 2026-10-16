/**
 * 会員の新規登録での担当(永久担当 owner_id)の決め方。CLAUDE.md §8.1 /members「新規登録」。
 * 純粋関数のみ。
 *
 * - 担当を選んだ → その人
 * - 「未設定」を選んだ(null / 空文字)→ 空のまま(2026-10-16 修正。以前は自分が入っていた)
 * - 担当の項目自体を送ってこない(undefined)→ 実行者
 */
export function resolveNewMemberOwner(
  ownerId: string | null | undefined,
  currentUserId: string,
): string | null {
  if (ownerId === undefined) return currentUserId;
  const s = (ownerId ?? '').trim();
  return s ? s.slice(0, 64) : null;
}
