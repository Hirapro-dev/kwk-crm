/**
 * Phase 2: 案件マスタ (projects) 取込
 *
 * 入力: csv/anken_csv.csv
 *   - 案件ID (T-XXXXXXXXX)
 *   - 案件 (案件名)
 *   - 使用中フラグ (○ = is_active=true, 空欄 = false)
 *
 * 出力: public.projects (text PK)
 *
 * 前提:
 *   - migration 09 を Supabase Studio で先に実行済 (projects.id が text 型)
 *   - 既存 projects は空 (migration 09 で TRUNCATE 済)
 *
 * 実行: npm run import:projects
 *       npm run import:projects -- --dry-run  (DB変更なしプレビュー)
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseArgs } from '../migrate/lib/args';
import { readCsv } from '../migrate/lib/csv';
import { createMigrateClient } from '../migrate/lib/db';
import { logger } from '../migrate/lib/logger';
import { nz } from '../migrate/lib/normalizers';

const CSV_PATH = './csv/anken_csv.csv';

interface ProjectRow {
  id: string;
  name: string;
  is_active: boolean;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const csvPath = resolve(process.cwd(), args.file ?? CSV_PATH);

  logger.info('Phase 2: projects 取込', { csv: csvPath, dryRun: args.dryRun });
  if (!existsSync(csvPath)) {
    logger.error(`CSV が見つかりません: ${csvPath}`);
    process.exit(1);
  }
  const rows = readCsv(csvPath, { trimValues: true });
  logger.info(`CSV読込: ${rows.length}件`);

  // CSV → ProjectRow 変換
  const projects: ProjectRow[] = [];
  const errors: string[] = [];
  for (const [i, r] of rows.entries()) {
    const id = nz(r['案件ID']);
    const name = nz(r['案件']);
    const flag = nz(r['使用中フラグ']);
    if (!id || !name) {
      errors.push(`行${i + 2}: 案件ID or 案件名が空 (id="${id}", name="${name}")`);
      continue;
    }
    if (!/^T-\d{9}$/.test(id)) {
      errors.push(`行${i + 2}: 案件ID 形式不正 "${id}" (期待: T-XXXXXXXXX)`);
      continue;
    }
    projects.push({
      id,
      name,
      is_active: flag === '○',
    });
  }

  if (errors.length > 0) {
    logger.warn(`変換エラー ${errors.length}件:`);
    for (const e of errors.slice(0, 20)) logger.warn(`  ${e}`);
    if (errors.length > 20) logger.warn(`  ... 他 ${errors.length - 20}件`);
  }

  logger.info(`投入対象: ${projects.length}件 (有効=${projects.filter((p) => p.is_active).length} / 無効=${projects.filter((p) => !p.is_active).length})`);

  if (args.dryRun) {
    logger.info('--dry-run: DB 投入はスキップ');
    for (const p of projects.slice(0, 10)) {
      logger.info(`  ${JSON.stringify(p)}`);
    }
    return;
  }

  // 投入 (upsert: 同じ id があれば更新)
  const supabase = createMigrateClient();
  const { error } = await supabase
    .from('projects')
    .upsert(
      projects.map((p) => ({
        id: p.id,
        name: p.name,
        description: null,
        is_active: p.is_active,
      })),
      { onConflict: 'id' },
    );

  if (error) {
    logger.error(`投入失敗: ${error.message}`);
    process.exit(1);
  }

  // 確認
  const { count } = await supabase
    .from('projects')
    .select('id', { count: 'exact', head: true });
  logger.info(`✅ 投入完了: DB件数=${count}`);
}

main().catch((e) => {
  logger.error('予期せぬエラー', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
