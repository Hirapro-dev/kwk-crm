/**
 * レポート結果の会員詳細リンク(CLAUDE.md §9.10b)。純粋関数。
 *
 * - 会員氏名・会員ID の列は、どのレポートタイプで選んでも会員詳細へのリンクにする。
 * - 集計した列(件数など)は値が ID や氏名ではないのでリンクにしない。
 * - グループは表示上の値でまとめるため、同姓同名の別会員が 1 つのグループに入ることがある。
 *   そのときは誤った会員へ飛ばないようリンクしない(各行の氏名セルは従来どおり行ごとにリンクする)。
 */

export interface LinkColumn {
  source: string;
  /** 集計した列(件数・合計など) */
  aggregated?: boolean;
}

/** 記事反応の会員氏名(スナップショット)も会員氏名として扱う */
const MEMBER_NAME_SOURCES: ReadonlySet<string> = new Set(['m.name', 'ar.member_name']);

/** 会員ID の列か(会員の項目 m.id と、申込・対応歴・問合せ・記事反応の項目の *.member_id) */
export function isMemberIdColumn(c: LinkColumn): boolean {
  return !c.aggregated && (c.source === 'm.id' || c.source.endsWith('.member_id'));
}

/** 会員氏名の列か */
export function isMemberNameColumn(c: LinkColumn): boolean {
  return !c.aggregated && MEMBER_NAME_SOURCES.has(c.source);
}

/** 会員詳細へリンクする列か */
export function isMemberLinkColumn(c: LinkColumn): boolean {
  return isMemberIdColumn(c) || isMemberNameColumn(c);
}

/** 行から会員ID を探す列の並び。隠し列を先に、次に選んでいる会員ID の列 */
export function memberIdAliases(
  columns: ReadonlyArray<LinkColumn & { alias: string }>,
  hiddenAlias: string,
): string[] {
  return [hiddenAlias, ...columns.filter(isMemberIdColumn).map((c) => c.alias)];
}

/** 行の会員ID。無ければ null(会員に紐付いていない行) */
export function rowMemberId(
  row: Readonly<Record<string, unknown>>,
  aliases: readonly string[],
): string | null {
  for (const alias of aliases) {
    const v = row[alias];
    if (v != null && String(v) !== '') return String(v);
  }
  return null;
}

/**
 * グループのまとめセルからリンクする会員ID。
 * すべての行が同じ会員のときだけ返す(別の会員や会員ID の無い行が混ざれば null)。
 */
export function groupMemberLinkId(
  rows: ReadonlyArray<Record<string, unknown>>,
  aliases: readonly string[],
): string | null {
  let id: string | null = null;
  for (const r of rows) {
    const v = rowMemberId(r, aliases);
    if (v === null) return null;
    if (id === null) id = v;
    else if (id !== v) return null;
  }
  return id;
}
