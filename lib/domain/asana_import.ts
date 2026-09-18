/**
 * Asana からの取込(CLAUDE.md §5.20)の純粋関数。CSV の行を CRM のタスクの形に写す。
 * DB の読み書きは scripts/import/import_asana_csv.ts。
 */

export interface AsanaCsvTask {
  asana_gid: string;
  name: string;
  notes: string | null;
  section_name: string | null;
  project_name: string | null;
  assignee_id: string | null;
  assignee_name_raw: string | null;
  start_date: string | null;
  due_date: string | null;
  completed_at: string | null;
  asana_created_at: string | null;
  parent_task_name: string | null;
  extra: Record<string, unknown>;
}

const nz = (v: string | undefined | null): string | null => {
  const s = (v ?? '').trim();
  return s ? s : null;
};

/** Asana CSV の日付(YYYY-MM-DD)を日本時間 0 時の ISO 文字列に。形式が違えば null */
function jstDate(v: string | null): string | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return `${v}T00:00:00+09:00`;
}

/**
 * CSV の 1 行 → タスク。usersByEmail は CRM ユーザーの email(小文字)→ id。
 * Task ID か Name が無い行は null。タグ・依存関係は extra に保持する。
 */
export function asanaCsvRowToTask(
  row: Record<string, string | undefined>,
  usersByEmail: ReadonlyMap<string, string>,
): AsanaCsvTask | null {
  const gid = nz(row['Task ID']);
  const name = nz(row.Name);
  if (!gid || !name) return null;
  const email = (nz(row['Assignee Email']) ?? '').toLowerCase();
  const extra: Record<string, unknown> = {};
  const tags = (nz(row.Tags) ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (tags.length > 0) extra.tags = tags;
  const blockedBy = nz(row['Blocked By (Dependencies)']);
  if (blockedBy) extra.blocked_by = blockedBy;
  const blocking = nz(row['Blocking (Dependencies)']);
  if (blocking) extra.blocking = blocking;
  return {
    asana_gid: gid,
    name,
    notes: nz(row.Notes),
    section_name: nz(row['Section/Column']),
    project_name: nz(row.Projects),
    assignee_id: email ? (usersByEmail.get(email) ?? null) : null,
    assignee_name_raw: nz(row.Assignee),
    start_date:
      nz(row['Start Date']) && /^\d{4}-\d{2}-\d{2}$/.test(row['Start Date'] ?? '')
        ? (row['Start Date'] ?? '').trim()
        : null,
    due_date:
      nz(row['Due Date']) && /^\d{4}-\d{2}-\d{2}$/.test(row['Due Date'] ?? '')
        ? (row['Due Date'] ?? '').trim()
        : null,
    completed_at: jstDate(nz(row['Completed At'])),
    asana_created_at: jstDate(nz(row['Created At'])),
    parent_task_name: nz(row['Parent task']),
    extra,
  };
}

/**
 * 親タスク名 → 親の asana_gid。同じファイル(=同じプロジェクト)内で名前が一意に決まるときだけ紐付け、
 * 同名が複数・見つからないときは null(呼び出し側で extra.parent_task_name に残す)。
 * 戻りは「親タスク名を持つ行」だけを含む。
 */
export function resolveParentGids(
  tasks: ReadonlyArray<{ asana_gid: string; name: string; parent_task_name: string | null }>,
): Map<string, string | null> {
  const byName = new Map<string, string[]>();
  for (const t of tasks) {
    const list = byName.get(t.name) ?? [];
    list.push(t.asana_gid);
    byName.set(t.name, list);
  }
  const out = new Map<string, string | null>();
  for (const t of tasks) {
    if (!t.parent_task_name) continue;
    const candidates = byName.get(t.parent_task_name) ?? [];
    out.set(t.asana_gid, candidates.length === 1 ? (candidates[0] ?? null) : null);
  }
  return out;
}
