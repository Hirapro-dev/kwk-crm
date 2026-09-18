/**
 * asana_export.ts が保存した JSON と添付を CRM のタスク管理へ取り込む(CLAUDE.md §5.20 API 取込の後半)。
 *
 * 使い方:
 *   npx tsx scripts/import/import_asana_json.ts --dir <asana_export のディレクトリ> [--dry-run] [--no-attachments]
 *
 * - プロジェクト: asana_gid で突合、無ければ名前で既存(CSV 取込で作った分)を探して asana_gid を付ける、それも無ければ作成。
 *   Asana の privacy_setting が private なら visibility=private にし、メンバーのうち CRM ユーザーとメールが一致する人を
 *   task_project_members に入れる(作成者=owner がいれば created_by)
 * - セクション: asana_gid、無ければ (project, name) で突合
 * - タスク: asana_gid で upsert(CSV 取込分も同じ gid なので上書き)。担当はメール、親は gid、セクションは membership
 * - コメント: asana_gid で upsert / 添付: asana_gid で突合し、無いものだけ Storage(task-attachments)にアップロード
 * - サービスロールで書き込む。何度実行しても増えない(冪等)
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  asanaColorToHex,
  asanaTaskToRow,
  commentsFromStories,
  withAsanaEmailAliases,
} from '../../lib/domain/asana_api_import';
import { storageSafeName } from '../../lib/domain/task_pure';
import { parseArgs } from '../migrate/lib/args';
import { createMigrateClient } from '../migrate/lib/db';
import { logger } from '../migrate/lib/logger';

const BATCH = 200;

interface ExportFile {
  project: {
    gid: string;
    name: string;
    color?: string | null;
    notes?: string | null;
    archived?: boolean;
    privacy_setting?: string | null;
    created_at?: string | null;
    members?: Array<{ name?: string | null; email?: string | null }>;
    owner?: { name?: string | null; email?: string | null } | null;
  };
  sections: Array<{ gid: string; name: string }>;
  tasks: Array<Record<string, unknown> & { gid: string; name: string }>;
  stories: Record<string, Array<Record<string, unknown>>>;
  attachments: Record<
    string,
    Array<{
      gid: string;
      name: string;
      size?: number | null;
      host?: string;
      view_url?: string | null;
      download_url?: string | null;
      created_at?: string;
      local_file?: string | null;
      created_by?: { email?: string | null } | null;
    }>
  >;
}

/**
 * 添付の実体を Storage にアップロードして保存キーを返す。失敗したら警告して null。
 * キーは ASCII 化した名前(storageSafeName)。Storage は日本語などのキーを「Invalid key」で拒否するため
 * (2026-09-18 に判明。元のファイル名は task_attachments.filename に持つ)。
 */
async function uploadAttachment(
  supabase: ReturnType<typeof createMigrateClient>,
  taskId: number,
  a: { gid: string; name: string; local_file?: string | null },
  dir: string,
): Promise<string | null> {
  if (!a.local_file) return null;
  const storagePath = `${taskId}/asana_${a.gid}_${storageSafeName(a.name)}`;
  const buf = readFileSync(join(dir, a.local_file));
  const up = await supabase.storage
    .from('task-attachments')
    .upload(storagePath, buf, { upsert: true });
  if (up.error) {
    logger.warn(`添付のアップロードに失敗(${a.name}): ${up.error.message}`);
    return null;
  }
  return storagePath;
}

async function main() {
  const args = parseArgs();
  const dir = args.dir;
  if (!dir) {
    logger.error('--dir <asana_export のディレクトリ> を指定してください');
    process.exit(1);
  }
  const withAttachments = !process.argv.includes('--no-attachments');
  const files = readdirSync(dir)
    .filter((f) => /^\d+\.json$/.test(f))
    .sort();
  logger.info(`対象ファイル ${files.length} 件`);
  const supabase = createMigrateClient();

  const { data: users, error: uErr } = await supabase
    .from('users')
    .select('id, email')
    .is('deleted_at', null);
  if (uErr) throw new Error(uErr.message);
  const crmUsersByEmail = new Map<string, string>();
  for (const u of (users ?? []) as Array<{ id: string; email: string }>)
    crmUsersByEmail.set(u.email.toLowerCase(), u.id);
  // Asana 側で別アドレスの人を CRM ユーザーに紐付ける(ASANA_EMAIL_ALIASES)
  const usersByEmail = withAsanaEmailAliases(crmUsersByEmail);

  const totals = { projects: 0, sections: 0, tasks: 0, comments: 0, attachments: 0, uploaded: 0 };
  for (const f of files) {
    const data = JSON.parse(readFileSync(join(dir, f), 'utf8')) as ExportFile;
    const p = data.project;
    const memberIds = [
      ...new Set(
        (p.members ?? [])
          .map((m) => usersByEmail.get((m.email ?? '').toLowerCase()))
          .filter((x): x is string => !!x),
      ),
    ];
    const ownerId = usersByEmail.get((p.owner?.email ?? '').toLowerCase()) ?? null;
    const visibility = p.privacy_setting === 'private' ? 'private' : 'public';
    const commentsCount = Object.values(data.stories).reduce((n, a) => n + a.length, 0);
    const attCount = Object.values(data.attachments).reduce((n, a) => n + a.length, 0);
    logger.info(
      `--- ${p.name}: セクション ${data.sections.length} / タスク ${data.tasks.length} / コメント ${commentsCount} / 添付 ${attCount} / ${visibility}(メンバー一致 ${memberIds.length}) ---`,
    );
    totals.projects++;
    totals.sections += data.sections.length;
    totals.tasks += data.tasks.length;
    totals.comments += commentsCount;
    totals.attachments += attCount;
    if (args.dryRun) continue;

    // プロジェクト
    let projectId: number | null = null;
    const byGid = await supabase
      .from('task_projects')
      .select('id')
      .eq('asana_gid', p.gid)
      .maybeSingle();
    if (byGid.data) projectId = (byGid.data as { id: number }).id;
    if (!projectId) {
      const byName = await supabase
        .from('task_projects')
        .select('id')
        .eq('name', p.name)
        .is('asana_gid', null)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle();
      if (byName.data) projectId = (byName.data as { id: number }).id;
    }
    const projectPatch = {
      name: p.name,
      color: asanaColorToHex(p.color),
      description: (p.notes ?? '').trim() || null,
      visibility,
      is_archived: !!p.archived,
      asana_gid: p.gid,
      ...(ownerId ? { created_by: ownerId } : {}),
    };
    if (projectId) {
      const { error } = await supabase
        .from('task_projects')
        .update(projectPatch)
        .eq('id', projectId);
      if (error) throw new Error(`プロジェクト更新に失敗: ${error.message}`);
    } else {
      const { data, error } = await supabase
        .from('task_projects')
        .insert(projectPatch)
        .select('id')
        .single();
      if (error) throw new Error(`プロジェクト作成に失敗: ${error.message}`);
      projectId = (data as { id: number }).id;
    }
    // メンバー(非公開のときだけ入れる。作成者は必ず含める)
    if (visibility === 'private') {
      const ids = new Set([...memberIds, ...(ownerId ? [ownerId] : [])]);
      if (ids.size > 0) {
        const { error } = await supabase.from('task_project_members').upsert(
          [...ids].map((user_id) => ({ project_id: projectId, user_id })),
          { onConflict: 'project_id,user_id', ignoreDuplicates: true },
        );
        if (error) throw new Error(`メンバー登録に失敗: ${error.message}`);
      }
    }

    // セクション
    const { data: existingSecs } = await supabase
      .from('task_sections')
      .select('id, name, asana_gid')
      .eq('project_id', projectId);
    const secByGid = new Map<string, number>();
    const secByName = new Map<string, number>();
    for (const s of (existingSecs ?? []) as Array<{
      id: number;
      name: string;
      asana_gid: string | null;
    }>) {
      if (s.asana_gid) secByGid.set(s.asana_gid, s.id);
      secByName.set(s.name, s.id);
    }
    let so = 0;
    for (const s of data.sections) {
      so += 100;
      const existingId = secByGid.get(s.gid) ?? secByName.get(s.name);
      if (existingId) {
        await supabase
          .from('task_sections')
          .update({ name: s.name, sort_order: so, asana_gid: s.gid })
          .eq('id', existingId);
        secByGid.set(s.gid, existingId);
      } else {
        const { data: ins, error } = await supabase
          .from('task_sections')
          .insert({ project_id: projectId, name: s.name, sort_order: so, asana_gid: s.gid })
          .select('id')
          .single();
        if (error) throw new Error(`セクション作成に失敗: ${error.message}`);
        secByGid.set(s.gid, (ins as { id: number }).id);
      }
    }

    // タスク(まず親なしで upsert → 親を解決)
    const rows = data.tasks.map((t) => asanaTaskToRow(t as never, p.gid, usersByEmail));
    const upserts = rows.map((r, i) => ({
      asana_gid: r.asana_gid,
      project_id: projectId,
      section_id: r.section_gid ? (secByGid.get(r.section_gid) ?? null) : null,
      name: r.name,
      notes: r.notes,
      assignee_id: r.assignee_id,
      assignee_name_raw: r.assignee_name_raw,
      start_date: r.start_date,
      due_date: r.due_date,
      completed_at: r.completed_at,
      asana_created_at: r.asana_created_at,
      sort_order: (i + 1) * 100,
      extra: r.extra,
    }));
    for (let i = 0; i < upserts.length; i += BATCH) {
      const { error } = await supabase
        .from('tasks')
        .upsert(upserts.slice(i, i + BATCH), { onConflict: 'asana_gid' });
      if (error) throw new Error(`tasks の upsert に失敗: ${error.message}`);
    }
    // asana_gid → tasks.id。PostgREST は 1 回 1,000 行までしか返さないため(db-max-rows)、
    // gid を 500 件ずつ IN で引く(2026-09-18 修正。以前は project_id で 1 回に引いていたため、1,000 件を超える
    // プロジェクトや複数プロジェクトに属するタスクのコメント・添付・親子が落ちていた)
    const idByGid = new Map<string, number>();
    const gids = rows.map((r) => r.asana_gid);
    for (let i = 0; i < gids.length; i += 500) {
      const { data: idRows, error: idErr } = await supabase
        .from('tasks')
        .select('id, asana_gid')
        .in('asana_gid', gids.slice(i, i + 500));
      if (idErr) throw new Error(`tasks の ID 取得に失敗: ${idErr.message}`);
      for (const r of (idRows ?? []) as Array<{ id: number; asana_gid: string }>)
        idByGid.set(r.asana_gid, r.id);
    }
    let linked = 0;
    for (const r of rows) {
      if (!r.parent_gid) continue;
      const cid = idByGid.get(r.asana_gid);
      const pid = idByGid.get(r.parent_gid);
      if (!cid || !pid) continue;
      const { error } = await supabase.from('tasks').update({ parent_task_id: pid }).eq('id', cid);
      if (error) throw new Error(`親子の更新に失敗: ${error.message}`);
      linked++;
    }

    // コメント
    let commentsUpserted = 0;
    for (const [taskGid, stories] of Object.entries(data.stories)) {
      const taskId = idByGid.get(taskGid);
      if (!taskId) continue;
      const cs = commentsFromStories(stories as never, usersByEmail).map((c) => ({
        ...c,
        task_id: taskId,
      }));
      if (cs.length === 0) continue;
      const { error } = await supabase
        .from('task_comments')
        .upsert(cs, { onConflict: 'asana_gid' });
      if (error) throw new Error(`コメントの upsert に失敗: ${error.message}`);
      commentsUpserted += cs.length;
    }

    // 添付
    let uploaded = 0;
    for (const [taskGid, atts] of Object.entries(data.attachments)) {
      const taskId = idByGid.get(taskGid);
      if (!taskId) continue;
      for (const a of atts) {
        const { data: ex } = await supabase
          .from('task_attachments')
          .select('id, storage_path')
          .eq('asana_gid', a.gid)
          .maybeSingle();
        const hasLocal = withAttachments && !!a.local_file && existsSync(join(dir, a.local_file));
        // 既に登録済み。ただし以前のアップロード失敗で外部リンク扱いになっているものは、実体があれば上げ直す
        if (ex) {
          const exRow = ex as { id: number; storage_path: string };
          if (!exRow.storage_path.startsWith('external:') || !hasLocal) continue;
          const path = await uploadAttachment(supabase, taskId, a, dir);
          if (!path) continue;
          const { error } = await supabase
            .from('task_attachments')
            .update({ storage_path: path })
            .eq('id', exRow.id);
          if (error) throw new Error(`添付の更新に失敗: ${error.message}`);
          uploaded++;
          continue;
        }
        let storagePath: string | null = null;
        if (hasLocal) storagePath = await uploadAttachment(supabase, taskId, a, dir);
        if (!storagePath) {
          // 実体が無い(外部リンク等)ものは URL を記録しておく
          if (!a.view_url) continue;
          storagePath = `external:${a.view_url}`;
        }
        const { error } = await supabase.from('task_attachments').insert({
          task_id: taskId,
          filename: a.name,
          content_type: null,
          size_bytes: a.size ?? null,
          storage_path: storagePath,
          uploaded_by: usersByEmail.get((a.created_by?.email ?? '').toLowerCase()) ?? null,
          asana_gid: a.gid,
          ...(a.created_at ? { created_at: a.created_at } : {}),
        });
        if (error) throw new Error(`添付の登録に失敗: ${error.message}`);
        if (!storagePath.startsWith('external:')) uploaded++;
      }
    }
    totals.uploaded += uploaded;
    logger.info(
      `  取込: タスク ${upserts.length} / 親子 ${linked} / コメント ${commentsUpserted} / 添付アップロード ${uploaded}`,
    );
  }
  logger.info(
    `=== 合計: プロジェクト ${totals.projects} / セクション ${totals.sections} / タスク ${totals.tasks} / コメント ${totals.comments} / 添付 ${totals.attachments}(アップロード ${totals.uploaded})${args.dryRun ? ' (--dry-run)' : ''} ===`,
  );
}

main().catch((e) => {
  logger.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
