/**
 * 移行スクリプト 02: 案件マスタ(projects) — 実 CSV 列名対応版
 * 仕様書 §4.1 §5.5 §6.1 Phase 1
 *
 * 入力: 申し込み情報.csv の「投資案件」列をユニーク抽出
 * 出力: public.projects
 *
 * 2026-05 更新: projects.category カラム廃止に伴い、カテゴリ判定ロジックを削除。
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseArgs } from './lib/args';
import { readCsv } from './lib/csv';
import { createMigrateClient } from './lib/db';
import { getEnv } from './lib/env';
import { writeErrors, type ErrorRecord } from './lib/error_writer';
import { logger } from './lib/logger';
import { nz } from './lib/normalizers';

const SCRIPT_NAME = '02_projects';
const DEFAULT_CSV = '申し込み情報.csv';

interface ProjectRow {
  name: string;
  description: string | null;
  is_active: boolean;
}

/**
 * 実 CSV では「投資案件」列。
 */
function extractProjectName(row: Record<string, string>): string | null {
  return nz(
    row['投資案件'] ?? row['案件名'] ?? row['案件'] ?? row['Project__c'] ?? row['project_name'],
  );
}

async function main(): Promise<void> {
  const args = parseArgs();
  const env = getEnv();
  const csvPath = resolve(process.cwd(), args.file ?? `${env.sourceDir}/${DEFAULT_CSV}`);

  logger.info(`移行開始: ${SCRIPT_NAME}`, { csv: csvPath, dryRun: args.dryRun });
  if (!existsSync(csvPath)) {
    logger.error(`CSVが見つかりません: ${csvPath}`);
    process.exit(1);
  }
  const rawRows = readCsv(csvPath, { trimValues: true });
  logger.info(`CSV読込完了: ${rawRows.length}件`);

  const uniqueNames = new Set<string>();
  for (const r of rawRows) {
    const name = extractProjectName(r);
    if (!name) continue;
    uniqueNames.add(name);
  }

  const projects: ProjectRow[] = [...uniqueNames].sort().map((name) => ({
    name,
    description: null,
    is_active: true,
  }));

  if (args.limit) projects.length = Math.min(projects.length, args.limit);

  logger.info(`抽出案件: ${projects.length}件`);

  if (args.dryRun) {
    logger.info('--dry-run: DB 投入はスキップ');
    for (const p of projects.slice(0, 10)) {
      logger.info('  ' + JSON.stringify(p));
    }
    return;
  }

  const supabase = createMigrateClient();
  const errors: ErrorRecord[] = [];

  const { error } = await supabase
    .from('projects')
    .upsert(projects, { onConflict: 'name', ignoreDuplicates: false });

  if (error) {
    logger.error('一括投入失敗、1件ずつretry', { message: error.message });
    let inserted = 0;
    let failed = 0;
    for (const p of projects) {
      const { error: se } = await supabase
        .from('projects')
        .upsert([p], { onConflict: 'name' });
      if (se) {
        failed++;
        errors.push({ name: p.name, _error: se.message });
      } else {
        inserted++;
      }
    }
    logger.info(`Retry結果: 成功=${inserted}, 失敗=${failed}`);
  } else {
    logger.info(`投入完了: ${projects.length}件`);
  }

  if (errors.length > 0) {
    const errPath = writeErrors(`${SCRIPT_NAME}_errors.csv`, errors);
    logger.warn(`エラーCSV出力: ${errPath}`);
  }

  const { count } = await supabase
    .from('projects')
    .select('id', { count: 'exact', head: true });
  logger.info(`DB 件数: ${count}`);
}

main().catch((e) => {
  logger.error('予期せぬエラー', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
