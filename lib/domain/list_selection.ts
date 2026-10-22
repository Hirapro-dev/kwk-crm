/**
 * 一覧のチェックの選択(共通部品 InfiniteTable)。2026-10-22 ユーザー要望で Shift を押しながらの範囲選択を追加。
 * Gmail などと同じく、前回チェックした行(anchorId)から今回の行までを、今回の行のクリック後の状態(選択 / 解除)にそろえる。
 * 前回の行が画面に無い(未チェック・削除・読み直し)ときは今回の行だけを切り替える。純粋関数(元の Set は書き換えない)。
 */
export function applyRowSelection(
  rowIds: readonly string[],
  selected: ReadonlySet<string>,
  targetId: string,
  opts: { shift: boolean; anchorId: string | null },
): Set<string> {
  const next = new Set(selected);
  const select = !selected.has(targetId);
  const from = opts.shift && opts.anchorId !== null ? rowIds.indexOf(opts.anchorId) : -1;
  const to = rowIds.indexOf(targetId);
  if (from < 0 || to < 0) {
    if (select) next.add(targetId);
    else next.delete(targetId);
    return next;
  }
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  for (const id of rowIds.slice(lo, hi + 1)) {
    if (select) next.add(id);
    else next.delete(id);
  }
  return next;
}
