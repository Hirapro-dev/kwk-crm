/**
 * Asana API の JSON(CLAUDE.md §5.20 API 取込)を CRM の形に写す純粋関数。
 * 取り出しは scripts/import/asana_export.ts、書込みは scripts/import/import_asana_json.ts。
 */

const COLOR_MAP: Record<string, string> = {
  'dark-pink': '#be185d',
  'dark-green': '#15803d',
  'dark-blue': '#1d4ed8',
  'dark-red': '#b91c1c',
  'dark-teal': '#0f766e',
  'dark-brown': '#92400e',
  'dark-orange': '#c2410c',
  'dark-purple': '#6d28d9',
  'dark-warm-gray': '#57534e',
  'light-pink': '#ec4899',
  'light-green': '#22c55e',
  'light-blue': '#3b82f6',
  'light-red': '#ef4444',
  'light-teal': '#14b8a6',
  'light-brown': '#d97706',
  'light-orange': '#f97316',
  'light-purple': '#8b5cf6',
  'light-warm-gray': '#a8a29e',
  'light-yellow': '#eab308',
  none: '#94a3b8',
};

export function asanaColorToHex(color: string | null | undefined): string {
  if (!color) return '#f97316';
  return COLOR_MAP[color] ?? '#f97316';
}

export interface AsanaTaskJson {
  gid: string;
  name: string;
  notes?: string | null;
  completed?: boolean;
  completed_at?: string | null;
  created_at?: string | null;
  assignee?: { gid?: string; name?: string | null; email?: string | null } | null;
  start_on?: string | null;
  due_on?: string | null;
  parent?: { gid: string } | null;
  memberships?: Array<{
    project?: { gid: string } | null;
    section?: { gid: string } | null;
  }> | null;
  tags?: Array<{ name: string }> | null;
  custom_fields?: Array<{ name: string; display_value: string | null }> | null;
  permalink_url?: string | null;
}

export interface TaskRowFromAsana {
  asana_gid: string;
  name: string;
  notes: string | null;
  assignee_id: string | null;
  assignee_name_raw: string | null;
  start_date: string | null;
  due_date: string | null;
  completed_at: string | null;
  asana_created_at: string | null;
  parent_gid: string | null;
  section_gid: string | null;
  extra: Record<string, unknown>;
}

/** タスク JSON → CRM の行(ID はまだ gid のまま。DB の id への解決は呼び出し側) */
export function asanaTaskToRow(
  t: AsanaTaskJson,
  projectGid: string,
  usersByEmail: ReadonlyMap<string, string>,
): TaskRowFromAsana {
  const email = (t.assignee?.email ?? '').trim().toLowerCase();
  const extra: Record<string, unknown> = {};
  const tags = (t.tags ?? []).map((x) => x.name).filter(Boolean);
  if (tags.length > 0) extra.tags = tags;
  const cf: Record<string, string> = {};
  for (const f of t.custom_fields ?? []) {
    if (
      f.name &&
      f.display_value !== null &&
      f.display_value !== undefined &&
      f.display_value !== ''
    )
      cf[f.name] = f.display_value;
  }
  if (Object.keys(cf).length > 0) extra.custom_fields = cf;
  if (t.permalink_url) extra.asana_url = t.permalink_url;
  const membership = (t.memberships ?? []).find((m) => m.project?.gid === projectGid);
  return {
    asana_gid: t.gid,
    name: (t.name ?? '').trim() || '(名称なし)',
    notes: (t.notes ?? '').trim() || null,
    assignee_id: email ? (usersByEmail.get(email) ?? null) : null,
    assignee_name_raw: (t.assignee?.name ?? '').trim() || null,
    start_date: t.start_on ?? null,
    due_date: t.due_on ?? null,
    completed_at: t.completed ? (t.completed_at ?? null) : null,
    asana_created_at: t.created_at ?? null,
    parent_gid: t.parent?.gid ?? null,
    section_gid: membership?.section?.gid ?? null,
    extra,
  };
}

export interface AsanaStoryJson {
  gid: string;
  type?: string | null;
  text?: string | null;
  created_at: string;
  created_by?: { name?: string | null; email?: string | null } | null;
}

export interface CommentFromAsana {
  asana_gid: string;
  body: string;
  created_at: string;
  user_id: string | null;
  author_name_raw: string | null;
}

/** stories のうち type=comment で本文のあるものだけをコメントにする */
export function commentsFromStories(
  stories: readonly AsanaStoryJson[],
  usersByEmail: ReadonlyMap<string, string>,
): CommentFromAsana[] {
  const out: CommentFromAsana[] = [];
  for (const s of stories) {
    if (s.type !== 'comment') continue;
    const body = (s.text ?? '').trim();
    if (!body) continue;
    const email = (s.created_by?.email ?? '').trim().toLowerCase();
    out.push({
      asana_gid: s.gid,
      body,
      created_at: s.created_at,
      user_id: email ? (usersByEmail.get(email) ?? null) : null,
      author_name_raw: (s.created_by?.name ?? '').trim() || null,
    });
  }
  return out;
}
