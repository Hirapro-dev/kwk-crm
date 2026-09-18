/**
 * タスク管理(CLAUDE.md §5.20)の表示ロジック(純粋関数。サーバー依存なし)。
 * セクションごとのグループ分け、マイタスクの並び、期日の見せ方、並び順の採番。
 */

export interface TaskSectionLike {
  id: number;
  name: string;
  sort_order: number;
}

export interface TaskLike {
  id: number;
  section_id: number | null;
  sort_order: number;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface TaskGroup<T extends TaskLike> {
  /** null = セクションなし */
  section: TaskSectionLike | null;
  tasks: T[];
}

/**
 * セクションの並び順どおりにタスクをまとめる。セクションが無い(または消えたセクションの)タスクは
 * 先頭の「セクションなし」グループに入れる(そのタスクが無ければグループ自体を出さない)。
 * 空のセクションも残す(追加先として表示するため)。セクション内は sort_order → id の順。
 */
export function groupTasksBySection<T extends TaskLike>(
  sections: readonly TaskSectionLike[],
  tasks: readonly T[],
): TaskGroup<T>[] {
  const ordered = [...sections].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  const known = new Set(ordered.map((s) => s.id));
  const byOrder = (a: T, b: T) => a.sort_order - b.sort_order || a.id - b.id;
  const none = tasks.filter((t) => t.section_id === null || !known.has(t.section_id)).sort(byOrder);
  const groups: TaskGroup<T>[] = [];
  if (none.length > 0) groups.push({ section: null, tasks: none });
  for (const s of ordered) {
    groups.push({ section: s, tasks: tasks.filter((t) => t.section_id === s.id).sort(byOrder) });
  }
  return groups;
}

/** マイタスクの並び: 期日あり(近い順)→ 期日なし。同じ期日(または期日なし同士)は作成が古い順 */
export function sortMyTasks<T extends TaskLike>(tasks: readonly T[]): T[] {
  return [...tasks].sort((a, b) => {
    if (a.due_date && b.due_date && a.due_date !== b.due_date)
      return a.due_date < b.due_date ? -1 : 1;
    if (a.due_date && !b.due_date) return -1;
    if (!a.due_date && b.due_date) return 1;
    return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id - b.id;
  });
}

export type DueTone = 'done' | 'overdue' | 'today' | 'soon' | 'normal' | 'none';

/** 期日の見せ方。today は YYYY-MM-DD(日本時間の今日)。7 日以内は soon */
export function dueTone(
  dueDate: string | null,
  completedAt: string | null,
  today: string,
): DueTone {
  if (completedAt) return 'done';
  if (!dueDate) return 'none';
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  const d = (Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000;
  return d <= 7 ? 'soon' : 'normal';
}

/** 末尾に追加するときの sort_order(最大値 + 100。空なら 100) */
export function nextSortOrder(tasks: readonly { sort_order: number }[]): number {
  if (tasks.length === 0) return 100;
  return Math.max(...tasks.map((t) => Number(t.sort_order))) + 100;
}

/** 日本時間の今日(YYYY-MM-DD) */
export function todayJst(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export interface DueGroup<T extends TaskLike> {
  key: 'overdue' | 'today' | 'week' | 'later' | 'none';
  label: string;
  tasks: T[];
}

/** マイタスクを Asana のように期日でグループ分けする(各グループ内は sortMyTasks の順)。空のグループは出さない */
export function groupMyTasksByDue<T extends TaskLike>(
  tasks: readonly T[],
  today: string,
): DueGroup<T>[] {
  const sorted = sortMyTasks(tasks);
  const buckets: Record<DueGroup<T>['key'], T[]> = {
    overdue: [],
    today: [],
    week: [],
    later: [],
    none: [],
  };
  for (const t of sorted) {
    const tone = dueTone(t.due_date, null, today);
    if (tone === 'overdue') buckets.overdue.push(t);
    else if (tone === 'today') buckets.today.push(t);
    else if (tone === 'soon') buckets.week.push(t);
    else if (tone === 'normal') buckets.later.push(t);
    else buckets.none.push(t);
  }
  const defs: Array<[DueGroup<T>['key'], string]> = [
    ['overdue', '期限切れ'],
    ['today', '今日'],
    ['week', '今後 7 日'],
    ['later', 'それ以降'],
    ['none', '期日なし'],
  ];
  return defs
    .filter(([k]) => buckets[k].length > 0)
    .map(([key, label]) => ({ key, label, tasks: buckets[key] }));
}
