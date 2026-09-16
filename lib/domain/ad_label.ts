/**
 * 広告ID の表示(CLAUDE.md §5.18)。純粋関数。
 * 問合せ・会員・LP の広告ID(N0000003 など)に、広告マスタの媒体名を併記する。
 * マスタに無い ID はそのまま、空は「-」。サーバー依存を持たない(一覧のクライアント部品からも使う)。
 */
export function adLabel(
  adId: string | null | undefined,
  names: Readonly<Record<string, string>>,
): string {
  const id = (adId ?? '').trim();
  if (!id) return '-';
  const name = names[id];
  return name ? `${id} ${name}` : id;
}
