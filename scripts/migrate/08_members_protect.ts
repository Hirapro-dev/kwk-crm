/**
 * 移行スクリプト 08: 会員プロテクト(protect__c)→ owner_name_raw 更新
 *
 * 入力: 顧客プロテクト.csv
 *   ヘッダー: OwnerId, protect__c, Name, Id, Member_ID__c
 *
 * 処理:
 *   - protect__c の値でグループ化し、同値の ID を IN句で一括 UPDATE
 *   - protect__c = "会社プロテクト" の行は owner_id = NULL も設定
 *
 * 使い方:
 *   npx tsx scripts/migrate/08_members_protect.ts --file "/path/to/顧客プロテクト.csv" --dry-run
 *   npx tsx scripts/migrate/08_members_protect.ts --file "/path/to/顧客プロテクト.csv"
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from './lib/args';
import { streamCsv } from './lib/csv_stream';
import { createMigrateClient } from './lib/db';
import { logger } from './lib/logger';

const SCRIPT_NAME = '08_members_protect';
const CHUNK_SIZE = 500; // IN句のID数上限

async function main(): Promise<void> {
  const args = parseArgs();

  if (!args.file) {
    logger.error('--file オプションでCSVパスを指定してください');
    process.exit(1);
  }

  const csvPath = resolve(process.cwd(), args.file);
  logger.info(`移行開始: ${SCRIPT_NAME}`, { csv: csvPath, dryRun: args.dryRun });

  if (!existsSync(csvPath)) {
    logger.error(`CSVが見つかりません: ${csvPath}`);
    process.exit(1);
  }

  // --- 1. CSV を全件読み込み、protect値でグループ化 ---
  const grouped = new Map<string, string[]>(); // protect__c → member_id[]
  let skipped = 0;

  await streamCsv(
    csvPath,
    async (row) => {
      const memberId = row['Member_ID__c']?.trim() ?? '';
      const protect = row['protect__c']?.trim() ?? '';

      if (!memberId || !memberId.startsWith('K-')) {
        skipped++;
        return;
      }

      const list = grouped.get(protect) ?? [];
      list.push(memberId);
      grouped.set(protect, list);
    },
    { trimValues: true },
  );

  const totalParsed = [...grouped.values()].reduce((s, v) => s + v.length, 0);
  logger.info(
    `CSV読込完了: ${totalParsed.toLocaleString()} 件, distinct protect値: ${grouped.size}, skipped: ${skipped}`,
  );

  if (args.dryRun) {
    for (const [protect, ids] of grouped) {
      logger.info(`[dry-run] "${protect}": ${ids.length.toLocaleString()} 件`);
    }
    logger.info('dry-run 完了。DBは変更されていません。');
    return;
  }

  // --- 2. protect値ごとに IN句で一括 UPDATE ---
  const supabase = createMigrateClient();
  const startedAt = Date.now();
  let totalUpdated = 0;
  let totalFailed = 0;

  for (const [protect, ids] of grouped) {
    const isCompanyProtect = protect === '会社プロテクト';

    // CHUNK_SIZE 件ずつに分割してリクエスト
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);

      const updatePayload = isCompanyProtect
        ? { owner_name_raw: protect, owner_id: null }
        : { owner_name_raw: protect };

      const { error, count } = await supabase
        .from('members')
        .update(updatePayload)
        .in('id', chunk)
        .select('id', { count: 'exact', head: true });

      if (error) {
        logger.warn(`更新失敗 protect="${protect}" chunk[${i}..${i + chunk.length}]: ${error.message}`);
        totalFailed += chunk.length;
      } else {
        totalUpdated += count ?? chunk.length;
      }
    }

    logger.info(`"${protect}": ${ids.length.toLocaleString()} 件 完了`);
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  logger.info(
    `処理完了: updated=${totalUpdated.toLocaleString()}, failed=${totalFailed}, 経過=${elapsed}秒`,
  );

  // 確認
  const { count } = await supabase
    .from('members')
    .select('id', { count: 'exact', head: true })
    .not('owner_name_raw', 'is', null);
  logger.info(`DB確認: owner_name_raw(プロテクト)設定済み会員数: ${count?.toLocaleString() ?? 0}`);
}

main().catch((e) => {
  logger.error('予期せぬエラー', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
