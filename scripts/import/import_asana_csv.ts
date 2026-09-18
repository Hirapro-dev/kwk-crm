/**
 * Asana の CSV エクスポートをタスク管理に取り込む(CLAUDE.md §5.20)。
 *
 * 使い方:
 *   npx tsx scripts/import/import_asana_csv.ts --file <csv> [--dry-run]
 *   npx tsx scripts/import/import_asana_csv.ts --dir <dir> [--dry-run]
 *
 * - プロジェクトは「Projects」列の名前で作成(無ければ追加。公開。asana_gid は API 取込で後から埋まる)
 * - セクションは「Section/Column」(「無題のセクション」も 1 セクション)
 * - タスクは Task ID(asana_gid)で upsert(再実行しても増えない。冪等)
 * - 担当は Assignee Email を users.email と完全一致で紐付け、一致しない人は assignee_name_raw に名前を残す
 * - サブタスクは Parent task の名前で同じファイル内の親を探す(同名が複数なら紐付けず extra.parent_task_name に残す)
 * - サービスロールで書き込む(RLS を通さない)。コメント・添付は CSV に無い(API 取込で)
 * 文字コード: Asana の CSV は UTF-8(BOM 付き)。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AsanaCsvTask,
  asanaCsvRowToTask,
  resolveParentGids,
} from '../../lib/domain/asana_import';
import { parseArgs } from '../migrate/lib/args';
import { parseCsvString } from '../migrate/lib/csv';
import { createMigrateClient } from '../migrate/lib/db';
import { logger } from '../migrate/lib/logger';

const BATCH = 200;

async function main() {
  const args = parseArgs();
  const files: string[] = [];
  if (args.file) files.push(args.file);
  if (args.dir) {
    for (const f of readdirSync(args.dir).sort()) {
      if (f.toLowerCase().endsWith('.csv') && !f.startsWith('._')) files.push(join(args.dir, f));
    }
  }
  if (files.length === 0) {
    logger.error('--file または --dir を指定してください');
    process.exit(1);
  }
  const supabase = createMigrateClient();

  // CRM ユーザー(メール → id)
  const { data: users, error: uErr } = await supabase
    .from('users')
    .select('id, email')
    .is('deleted_at', null);
  if (uErr) throw new Error(`users の取得に失敗: ${uErr.message}`);
  const usersByEmail = new Map<string, string>();
  for (const u of (users ?? []) as Array<{ id: string; email: string }>)
    usersByEmail.set(u.email.toLowerCase(), u.id);

  let totalRows = 0;
  let totalUpserted = 0;
  for (const file of files) {
    logger.info(`--- ${file} ---`);
    const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
    const rows = parseCsvString(text);
    const tasks: AsanaCsvTask[] = [];
    let skipped = 0;
    for (const r of rows) {
      const t = asanaCsvRowToTask(r, usersByEmail);
      if (t) tasks.push(t);
      else skipped++;
    }
    totalRows += rows.length;
    const projectName =
      tasks.find((t) => t.project_name)?.project_name ??
      file.replace(/^.*\//, '').replace(/\.csv$/i, '');
    const sectionNames = [
      ...new Set(tasks.map((t) => t.section_name).filter((s): s is string => !!s)),
    ];
    const parents = resolveParentGids(tasks);
    const unresolvedParents = [...parents.values()].filter((v) => v === null).length;
    const unmatchedAssignees = new Set(
      tasks.filter((t) => t.assignee_name_raw && !t.assignee_id).map((t) => t.assignee_name_raw),
    );
    logger.info(
      `行 ${rows.length} / 取込対象 ${tasks.length} / 除外(ID か名前なし) ${skipped} / プロジェクト「${projectName}」 / セクション ${sectionNames.length} / ` +
        `サブタスク ${parents.size}(親が決まらない ${unresolvedParents}) / 担当が CRM に無い人 ${unmatchedAssignees.size} 名 / 完了済み ${tasks.filter((t) => t.completed_at).length}`,
    );
    if (args.dryRun) continue;

    // プロジェクト(名前で解決。無ければ作成)
    let projectId: number;
    const { data: existing } = await supabase
      .from('task_projects')
      .select('id')
      .eq('name', projectName)
      .is('deleted_at', null)
      .maybeSingle();
    if (existing) projectId = (existing as { id: number }).id;
    else {
      const { data: created, error } = await supabase
        .from('task_projects')
        .insert({ name: projectName, visibility: 'public', color: '#f97316' })
        .select('id')
        .single();
      if (error) throw new Error(`プロジェクトの作成に失敗: ${error.message}`);
      projectId = (created as { id: number }).id;
      logger.info(`プロジェクトを作成: ${projectName} (#${projectId})`);
    }

    // セクション(名前で解決。無ければ作成。並びは CSV に出てきた順)
    const { data: secRows } = await supabase
      .from('task_sections')
      .select('id, name, sort_order')
      .eq('project_id', projectId);
    const sectionIdByName = new Map<string, number>();
    let so = Math.max(
      0,
      ...((secRows ?? []) as Array<{ sort_order: number }>).map((s) => s.sort_order),
    );
    for (const s of (secRows ?? []) as Array<{ id: number; name: string }>)
      sectionIdByName.set(s.name, s.id);
    for (const name of sectionNames) {
      if (sectionIdByName.has(name)) continue;
      so += 100;
      const { data: sec, error } = await supabase
        .from('task_sections')
        .insert({ project_id: projectId, name, sort_order: so })
        .select('id')
        .single();
      if (error) throw new Error(`セクションの作成に失敗: ${error.message}`);
      sectionIdByName.set(name, (sec as { id: number }).id);
    }

    // タスク(まず全件を親なしで upsert → 親の gid → id を引いて parent_task_id を更新)
    const rowsToUpsert = tasks.map((t, i) => ({
      asana_gid: t.asana_gid,
      project_id: projectId,
      section_id: t.section_name ? (sectionIdByName.get(t.section_name) ?? null) : null,
      name: t.name,
      notes: t.notes,
      assignee_id: t.assignee_id,
      assignee_name_raw: t.assignee_name_raw,
      start_date: t.start_date,
      due_date: t.due_date,
      completed_at: t.completed_at,
      asana_created_at: t.asana_created_at,
      sort_order: (i + 1) * 100,
      extra: {
        ...t.extra,
        ...(t.parent_task_name && parents.get(t.asana_gid) === null
          ? { parent_task_name: t.parent_task_name }
          : {}),
      },
    }));
    for (let i = 0; i < rowsToUpsert.length; i += BATCH) {
      const { error } = await supabase
        .from('tasks')
        .upsert(rowsToUpsert.slice(i, i + BATCH), { onConflict: 'asana_gid' });
      if (error) throw new Error(`tasks の upsert に失敗(${i}〜): ${error.message}`);
    }
    totalUpserted += rowsToUpsert.length;

    // 親子
    const gids = [...parents.entries()].filter(([, p]) => p !== null);
    if (gids.length > 0) {
      const { data: idRows } = await supabase
        .from('tasks')
        .select('id, asana_gid')
        .in('asana_gid', [...new Set(gids.flatMap(([c, p]) => [c, p as string]))]);
      const idByGid = new Map(
        ((idRows ?? []) as Array<{ id: number; asana_gid: string }>).map((r) => [
          r.asana_gid,
          r.id,
        ]),
      );
      let linked = 0;
      for (const [child, parent] of gids) {
        const cid = idByGid.get(child);
        const pid = idByGid.get(parent as string);
        if (!cid || !pid) continue;
        const { error } = await supabase
          .from('tasks')
          .update({ parent_task_id: pid })
          .eq('id', cid);
        if (error) throw new Error(`親子の更新に失敗: ${error.message}`);
        linked++;
      }
      logger.info(`サブタスクの親を設定: ${linked} 件`);
    }
    logger.info(`完了: ${rowsToUpsert.length} 件を tasks に upsert`);
  }
  logger.info(
    `=== 合計: 行 ${totalRows} / upsert ${totalUpserted}${args.dryRun ? '(--dry-run のため書き込みなし)' : ''} ===`,
  );
}

main().catch((e) => {
  logger.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
