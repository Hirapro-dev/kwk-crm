/**
 * レポート結果のグループ表示で、まとめたセル(会員氏名)から会員詳細へリンクするときの会員ID。
 * グループは表示上の氏名でまとめるため、同姓同名の別会員が 1 つのグループに入ることがある。
 * そのときは誤った会員へ飛ばないようリンクしない(null)。各行の氏名セルは従来どおり行ごとにリンクする。
 */
export function groupMemberLinkId(
  rows: ReadonlyArray<Record<string, unknown>>,
  idAlias: string,
): string | null {
  let id: string | null = null;
  for (const r of rows) {
    const v = r[idAlias];
    if (v == null || String(v) === '') return null;
    if (id === null) id = String(v);
    else if (id !== String(v)) return null;
  }
  return id;
}
