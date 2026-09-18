/**
 * Asana のワークスペース全体を JSON と添付ファイルに保存する(CLAUDE.md §5.20 API 取込の前半)。
 *
 * 使い方:
 *   ASANA_ACCESS_TOKEN を .env.local に入れて
 *   npx tsx scripts/import/asana_export.ts [--out <dir>] [--no-attachments] [--project <gid>]
 *   既定の出力先: ./asana_export(git 管理外)。プロジェクトごとに <gid>.json、添付は attachments/<添付gid>_<ファイル名>
 *
 * 取るもの: プロジェクト(名前・色・説明・公開設定・アーカイブ・メンバー)/ セクション / タスク(サブタスクは再帰)/
 *           コメント(stories の comment)/ 添付(download_url からダウンロード。Asana 添付のみ。外部リンクは URL を記録)
 * 読み取り専用。Asana のレート制限(429)は待って再試行する。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../migrate/lib/logger';

for (const line of existsSync('.env.local') ? readFileSync('.env.local', 'utf8').split('\n') : []) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m?.[1] && m[2] !== undefined && !process.env[m[1]])
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const TOKEN = process.env.ASANA_ACCESS_TOKEN ?? '';
if (!TOKEN) {
  logger.error('ASANA_ACCESS_TOKEN が未設定です(.env.local)');
  process.exit(1);
}

const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const OUT = arg('--out') ?? './asana_export';
const ONLY_PROJECT = arg('--project');
const WITH_ATTACHMENTS = !argv.includes('--no-attachments');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T = unknown>(
  path: string,
): Promise<{ data: T; next_page?: { offset: string } | null }> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(`https://app.asana.com/api/1.0${path}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (res.status === 429) {
      const wait = Number(res.headers.get('Retry-After') ?? '10') * 1000;
      logger.warn(`レート制限。${wait / 1000} 秒待ちます`);
      await sleep(wait);
      continue;
    }
    if (res.status >= 500) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    const json = (await res.json()) as {
      data: T;
      next_page?: { offset: string } | null;
      errors?: unknown;
    };
    if (!res.ok)
      throw new Error(
        `${res.status} ${path}: ${JSON.stringify(json.errors ?? json).slice(0, 300)}`,
      );
    return json;
  }
  throw new Error(`再試行しても失敗: ${path}`);
}

async function apiAll<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  let offset = '';
  do {
    const sep = path.includes('?') ? '&' : '?';
    const r = await api<T[]>(`${path}${sep}limit=100${offset ? `&offset=${offset}` : ''}`);
    out.push(...r.data);
    offset = r.next_page?.offset ?? '';
  } while (offset);
  return out;
}

const TASK_FIELDS =
  'name,notes,completed,completed_at,created_at,modified_at,assignee.name,assignee.email,start_on,due_on,parent.gid,' +
  'memberships.project.gid,memberships.section.gid,tags.name,custom_fields.name,custom_fields.display_value,num_subtasks,permalink_url';

interface TaskJson {
  gid: string;
  num_subtasks?: number;
  [k: string]: unknown;
}

async function fetchSubtasksRecursive(task: TaskJson, acc: TaskJson[], depth = 0): Promise<void> {
  if (!task.num_subtasks || depth > 5) return;
  const subs = await apiAll<TaskJson>(`/tasks/${task.gid}/subtasks?opt_fields=${TASK_FIELDS}`);
  for (const s of subs) {
    acc.push(s);
    await fetchSubtasksRecursive(s, acc, depth + 1);
  }
}

async function downloadAttachment(url: string, dest: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(dest, buf);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (WITH_ATTACHMENTS) mkdirSync(join(OUT, 'attachments'), { recursive: true });
  const me = await api<{ workspaces: Array<{ gid: string; name: string }> }>(
    '/users/me?opt_fields=workspaces.name',
  );
  const summary: Array<Record<string, unknown>> = [];
  for (const ws of me.data.workspaces) {
    const projects: Array<Record<string, unknown> & { gid: string; name: string }> = [];
    for (const archived of ['false', 'true']) {
      projects.push(
        ...(await apiAll<Record<string, unknown> & { gid: string; name: string }>(
          `/projects?workspace=${ws.gid}&archived=${archived}&opt_fields=name,color,notes,archived,privacy_setting,created_at,modified_at,members.name,members.email,owner.name,owner.email,permalink_url`,
        )),
      );
    }
    logger.info(`ワークスペース「${ws.name}」: プロジェクト ${projects.length} 件`);
    for (const p of projects) {
      if (ONLY_PROJECT && p.gid !== ONLY_PROJECT) continue;
      const file = join(OUT, `${p.gid}.json`);
      const sections = await apiAll<{ gid: string; name: string }>(
        `/projects/${p.gid}/sections?opt_fields=name,created_at`,
      );
      const tasks = await apiAll<TaskJson>(`/tasks?project=${p.gid}&opt_fields=${TASK_FIELDS}`);
      const all: TaskJson[] = [...tasks];
      for (const t of tasks) await fetchSubtasksRecursive(t, all);
      // gid で重複排除(サブタスクがプロジェクトにも直接入っている場合)
      const uniq = new Map<string, TaskJson>();
      for (const t of all) uniq.set(t.gid, t);
      const stories: Record<string, unknown[]> = {};
      const attachments: Record<string, unknown[]> = {};
      let attachmentCount = 0;
      let downloaded = 0;
      for (const t of uniq.values()) {
        const st = await apiAll<Record<string, unknown>>(
          `/tasks/${t.gid}/stories?opt_fields=type,resource_subtype,text,created_at,created_by.name,created_by.email`,
        );
        const comments = st.filter((s) => s.type === 'comment');
        if (comments.length > 0) stories[t.gid] = comments;
        const at = await apiAll<
          Record<string, unknown> & {
            gid: string;
            name: string;
            download_url?: string | null;
            host?: string;
          }
        >(
          `/tasks/${t.gid}/attachments?opt_fields=name,download_url,size,host,created_at,resource_subtype,view_url,created_by.email`,
        );
        if (at.length > 0) {
          attachments[t.gid] = at.map((a) => ({ ...a, local_file: null as string | null }));
          attachmentCount += at.length;
          if (WITH_ATTACHMENTS) {
            for (const [i, a] of at.entries()) {
              if (!a.download_url) continue;
              const safe = a.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 150);
              const dest = join(OUT, 'attachments', `${a.gid}_${safe}`);
              const ok = existsSync(dest) || (await downloadAttachment(a.download_url, dest));
              if (ok) {
                downloaded++;
                (attachments[t.gid][i] as Record<string, unknown>).local_file =
                  `attachments/${a.gid}_${safe}`;
              }
            }
          }
        }
      }
      const payload = {
        workspace: { gid: ws.gid, name: ws.name },
        project: p,
        sections,
        tasks: [...uniq.values()],
        stories,
        attachments,
        exported_at: new Date().toISOString(),
      };
      writeFileSync(file, JSON.stringify(payload));
      const line = {
        project: p.name,
        gid: p.gid,
        archived: p.archived,
        privacy: p.privacy_setting,
        sections: sections.length,
        tasks: uniq.size,
        comments: Object.values(stories).reduce((n, a) => n + a.length, 0),
        attachments: attachmentCount,
        downloaded,
      };
      summary.push(line);
      logger.info(
        `  ${p.name}: セクション ${sections.length} / タスク ${uniq.size} / コメント ${line.comments} / 添付 ${attachmentCount}(保存 ${downloaded})`,
      );
    }
  }
  writeFileSync(join(OUT, '_summary.json'), JSON.stringify(summary, null, 2));
  logger.info(`完了: ${summary.length} プロジェクトを ${OUT} に保存`);
}

main().catch((e) => {
  logger.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
