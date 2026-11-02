/**
 * レポートのフィルタ条件ツリーを操作する純粋関数 (仕様書 §9.5.2)
 *
 * 画面の状態はレポート定義と同じ形 (ReportFilterGroup) で持ち、ここにある関数で
 * 不変に書き換える。「(A OR B) AND C」のように、全体の結合 (AND / OR) とは別に
 * 条件グループごとの結合を持てる。
 *
 * 位置はインデックスの配列 (パス) で表す:
 *   - グループのパス: [] = 全体、[2] = 全体の 3 番目の要素 (グループ)
 *   - 要素のパス:     [0] = 全体の 1 番目、[2, 1] = 3 番目のグループの 2 番目
 *
 * 画面から作れるグループは全体の直下の 1 段だけ。保存済みの定義にそれより深い
 * グループがあっても、読み込み・保存で落とさない (SQL Builder は任意の深さに対応)。
 */
import type { FilterOperator, ReportFilterCondition, ReportFilterGroup } from './types';

export type FilterLogic = ReportFilterGroup['logic'];
export type FilterItem = ReportFilterGroup['conditions'][number];
export type FilterPath = readonly number[];

export function isFilterGroupItem(item: FilterItem): item is { group: ReportFilterGroup } {
  return 'group' in item;
}

export function emptyFilterGroup(logic: FilterLogic = 'AND'): ReportFilterGroup {
  return { logic, conditions: [] };
}

/**
 * 保存済みの定義から画面の状態を作る。未設定なら空の AND グループ。
 * 条件の op / value / values はそのまま残す (画面で扱わない values も消さない)。
 */
export function filterGroupFromDefinition(group: ReportFilterGroup | undefined): ReportFilterGroup {
  if (!group) return emptyFilterGroup();
  return cloneGroup(group);
}

function cloneGroup(group: ReportFilterGroup): ReportFilterGroup {
  return {
    logic: group.logic === 'OR' ? 'OR' : 'AND',
    conditions: (group.conditions ?? []).map((c) =>
      isFilterGroupItem(c) ? { group: cloneGroup(c.group) } : { ...c },
    ),
  };
}

/**
 * 保存・プレビューに渡す形にする。条件の無いグループは取り除き、
 * 条件が 1 つも無ければ undefined (フィルタなし)。
 */
export function normalizeFilterGroup(group: ReportFilterGroup): ReportFilterGroup | undefined {
  const conditions: FilterItem[] = [];
  for (const c of group.conditions) {
    if (isFilterGroupItem(c)) {
      const inner = normalizeFilterGroup(c.group);
      if (inner) conditions.push({ group: inner });
    } else {
      conditions.push(c);
    }
  }
  if (conditions.length === 0) return undefined;
  return { logic: group.logic, conditions };
}

/** グループの中を含めた条件の数 (タブのバッジ表示用)。 */
export function countFilterConditions(group: ReportFilterGroup): number {
  let n = 0;
  for (const c of group.conditions) {
    n += isFilterGroupItem(c) ? countFilterConditions(c.group) : 1;
  }
  return n;
}

/** パスのグループを fn で置き換えた新しいツリーを返す。パスが不正なら元のまま。 */
function updateGroupAt(
  root: ReportFilterGroup,
  groupPath: FilterPath,
  fn: (g: ReportFilterGroup) => ReportFilterGroup,
): ReportFilterGroup {
  if (groupPath.length === 0) return fn(root);
  const [head, ...rest] = groupPath;
  const target = root.conditions[head as number];
  if (!target || !isFilterGroupItem(target)) return root;
  const conditions = [...root.conditions];
  conditions[head as number] = { group: updateGroupAt(target.group, rest, fn) };
  return { ...root, conditions };
}

export function getGroupAt(
  root: ReportFilterGroup,
  groupPath: FilterPath,
): ReportFilterGroup | null {
  let g: ReportFilterGroup = root;
  for (const i of groupPath) {
    const item = g.conditions[i];
    if (!item || !isFilterGroupItem(item)) return null;
    g = item.group;
  }
  return g;
}

export function setGroupLogic(
  root: ReportFilterGroup,
  groupPath: FilterPath,
  logic: FilterLogic,
): ReportFilterGroup {
  return updateGroupAt(root, groupPath, (g) => ({ ...g, logic }));
}

/** グループの末尾に条件を追加する。 */
export function addConditionTo(
  root: ReportFilterGroup,
  groupPath: FilterPath,
  condition: ReportFilterCondition,
): ReportFilterGroup {
  return updateGroupAt(root, groupPath, (g) => ({
    ...g,
    conditions: [...g.conditions, condition],
  }));
}

/**
 * グループの末尾に空の条件グループを追加する。中の結合は親の逆を既定にする
 * (全体が AND ならグループは OR。「(A OR B) AND C」が最も多い使い方のため)。
 */
export function addGroupTo(root: ReportFilterGroup, groupPath: FilterPath): ReportFilterGroup {
  return updateGroupAt(root, groupPath, (g) => ({
    ...g,
    conditions: [...g.conditions, { group: emptyFilterGroup(g.logic === 'AND' ? 'OR' : 'AND') }],
  }));
}

/** 要素 (条件またはグループ) を取り除く。 */
export function removeItemAt(root: ReportFilterGroup, itemPath: FilterPath): ReportFilterGroup {
  if (itemPath.length === 0) return root;
  const parentPath = itemPath.slice(0, -1);
  const index = itemPath[itemPath.length - 1] as number;
  return updateGroupAt(root, parentPath, (g) => ({
    ...g,
    conditions: g.conditions.filter((_, i) => i !== index),
  }));
}

/** 条件の演算子・値を書き換える。グループを指すパスなら何もしない。 */
export function updateConditionAt(
  root: ReportFilterGroup,
  itemPath: FilterPath,
  patch: { op?: FilterOperator; value?: unknown },
): ReportFilterGroup {
  if (itemPath.length === 0) return root;
  const parentPath = itemPath.slice(0, -1);
  const index = itemPath[itemPath.length - 1] as number;
  return updateGroupAt(root, parentPath, (g) => {
    const target = g.conditions[index];
    if (!target || isFilterGroupItem(target)) return g;
    const conditions = [...g.conditions];
    conditions[index] = { ...target, ...patch };
    return { ...g, conditions };
  });
}

/**
 * 条件を別のグループの末尾へ移す。移動先へ足してから元を消す
 * (足すのは移動先の末尾なので、元の位置のインデックスはずれない)。
 */
export function moveConditionTo(
  root: ReportFilterGroup,
  itemPath: FilterPath,
  targetGroupPath: FilterPath,
): ReportFilterGroup {
  if (itemPath.length === 0) return root;
  const parentPath = itemPath.slice(0, -1);
  if (samePath(parentPath, targetGroupPath)) return root;
  const parent = getGroupAt(root, parentPath);
  const item = parent?.conditions[itemPath[itemPath.length - 1] as number];
  if (!item || isFilterGroupItem(item)) return root;
  if (!getGroupAt(root, targetGroupPath)) return root;
  return removeItemAt(addConditionTo(root, targetGroupPath, item), itemPath);
}

function samePath(a: FilterPath, b: FilterPath): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * 条件の移動先の候補: 全体と、全体の直下にあるグループ (「グループ1」「グループ2」…)。
 */
export function moveTargets(root: ReportFilterGroup): { path: number[]; label: string }[] {
  const out: { path: number[]; label: string }[] = [{ path: [], label: '全体' }];
  let n = 0;
  root.conditions.forEach((c, i) => {
    if (isFilterGroupItem(c)) {
      n += 1;
      out.push({ path: [i], label: `グループ${n}` });
    }
  });
  return out;
}

/**
 * 条件を読める式にする。例: 「(会員氏名 を含む 山田 OR 電話 NULL) AND 総取引額 >= 100」
 * 中身の無いグループは省く。条件が無ければ空文字。
 */
export function describeFilterGroup(
  group: ReportFilterGroup,
  describeCondition: (c: ReportFilterCondition) => string,
): string {
  return describeInner(group, describeCondition, true);
}

function describeInner(
  group: ReportFilterGroup,
  describeCondition: (c: ReportFilterCondition) => string,
  isRoot: boolean,
): string {
  const parts: string[] = [];
  for (const c of group.conditions) {
    if (isFilterGroupItem(c)) {
      const inner = describeInner(c.group, describeCondition, false);
      if (inner) parts.push(inner);
    } else {
      parts.push(describeCondition(c));
    }
  }
  if (parts.length === 0) return '';
  const joined = parts.join(` ${group.logic} `);
  return !isRoot && parts.length > 1 ? `(${joined})` : joined;
}
