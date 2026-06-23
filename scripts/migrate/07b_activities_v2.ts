/**
 * 移行スクリプト 07b: 対応歴(activities) — 新フォーマット(extract.csv)対応版
 *
 * 入力: extract.csv
 *   ヘッダー: 対応歴ID, 会員ID, 担当, 接触種別, 接触内容, 状態, 登録日時, Description
 *   (Web取込と同じ列。Salesforce形式の旧 07_activities.ts とは別)
 *
 * 変換ロジックは Web取込と共通の lib/import/activities_map.ts(convertActivityRow)を再利用。
 *   - 対応歴ID → legacy_sf_id(突合キー。無ければ行内容ハッシュ)
 *   - 会員ID(K-) → member_id(既存のみ)、担当 → owner_id(氏名解決)
 *   - 接触種別/接触内容/状態 → d/m/s_bunrui(自由文字列)、Description/対応詳細 → description
 *   - 登録日時 → registered_datetime
 *
 * 大量(120万件)対応: streamCsv で行単位読込 + バッチ upsert(onConflict legacy_sf_id)。
 * 使い方:
 *   npx tsx scripts/migrate/07b_activities_v2.ts --file ./csv/extract.csv --dry-run --limit 2000
 *   npx tsx scripts/migrate/07b_activities_v2.ts --file ./csv/extract.csv
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type ActivityRecord,
  type ActivityResolveMaps,
  convertActivityRow,
} from '../../lib/import/activities_map';
import { parseArgs } from './lib/args';
import { streamCsv } from './lib/csv_stream';
import { createMigrateClient, type MigrateClient } from './lib/db';
import { getEnv } from './lib/env';
import { type ErrorRecord, writeErrors } from './lib/error_writer';
import { logger } from './lib/logger';

const SCRIPT_NAME = '07b_activities_v2';
const DEFAULT_CSV = 'extract.csv';
const BATCH_SIZE = 1000;
const PROGRESS_EVERY = 5000;

async function loadResolveMaps(supabase: MigrateClient): Promise<ActivityResolveMaps> {
  const ownerByFullName = new Map<string, string>();
  const ownerByLastName = new Map<string, string>();
  const { data: users } = await supabase.from('users').select('id, full_name, last_name');
  for (const u of (users ?? []) as Array<{
    id: string;
    full_name: string | null;
    last_name: string | null;
  }>) {
    if (u.full_name) ownerByFullName.set(u.full_name, u.id);
    if (u.last_name && !ownerByLastName.has(u.last_name)) ownerByLastName.set(u.last_name, u.id);
  }

  // 会員ID(FK解決用)を全件ページングで取得
  const validMemberIds = new Set<string>();
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('members')
      .select('id')
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const r of data as Array<{ id: string }>) validMemberIds.add(r.id);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  return { validMemberIds, ownerByFullName, ownerByLastName };
}

async function flushBatch(
  supabase: MigrateClient,
  batch: ActivityRecord[],
  errors: ErrorRecord[],
): Promise<{ inserted: number; failed: number }> {
  if (batch.length === 0) return { inserted: 0, failed: 0 };
  const { error } = await supabase
    .from('activities')
    .upsert(batch, { onConflict: 'legacy_sf_id', ignoreDuplicates: false });
  if (!error) return { inserted: batch.length, failed: 0 };
  logger.warn('バッチ失敗、1件ずつretry', { message: error.message, size: batch.length });
  let inserted = 0;
  let failed = 0;
  for (const r of batch) {
    const { error: se } = await supabase
      .from('activities')
      .upsert([r], { onConflict: 'legacy_sf_id' });
    if (se) {
      failed++;
      errors.push({ legacy_sf_id: r.legacy_sf_id, _error: se.message });
    } else {
      inserted++;
    }
  }
  return { inserted, failed };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const env = getEnv();
  const csvPath = resolve(process.cwd(), args.file ?? `${env.sourceDir}/${DEFAULT_CSV}`);

  logger.info(`移行開始: ${SCRIPT_NAME}`, {
    csv: csvPath,
    dryRun: args.dryRun,
    limit: args.limit ?? '無制限',
  });
  if (!existsSync(csvPath)) {
    logger.error(`CSVが見つかりません: ${csvPath}`);
    process.exit(1);
  }

  const supabase = createMigrateClient();
  const maps = await loadResolveMaps(supabase);
  logger.info(
    `解決マップ構築: users(full=${maps.ownerByFullName.size}), members=${maps.validMemberIds.size}`,
  );

  const errors: ErrorRecord[] = [];
  // 同一 legacy_sf_id の重複は最後の行で上書き(バッチ内の重複キーupsertエラー回避)
  let buffer = new Map<string, ActivityRecord>();
  let totalInserted = 0;
  let totalFailed = 0;
  let totalParsed = 0;
  let csvLines = 0;
  const startedAt = Date.now();

  const flush = async () => {
    if (buffer.size === 0) return;
    const result = await flushBatch(supabase, [...buffer.values()], errors);
    totalInserted += result.inserted;
    totalFailed += result.failed;
    buffer = new Map();
  };

  await streamCsv(
    csvPath,
    async (row) => {
      csvLines++;
      if (args.limit && totalParsed >= args.limit) return;

      const out = convertActivityRow(row, csvLines, maps);
      if (out.error || !out.record) {
        if (out.error) errors.push({ row: String(csvLines), _error: out.error });
        return;
      }
      totalParsed++;
      buffer.set(out.record.legacy_sf_id, out.record);

      if (buffer.size >= BATCH_SIZE && !args.dryRun) {
        await flush();
      }

      if (totalParsed % PROGRESS_EVERY === 0) {
        const elapsed = (Date.now() - startedAt) / 1000;
        logger.info(
          `進捗: parsed=${totalParsed.toLocaleString()}, inserted=${totalInserted.toLocaleString()}, failed=${totalFailed} (${(totalParsed / elapsed).toFixed(0)} rows/sec)`,
        );
      }
    },
    { trimValues: false },
  );

  if (!args.dryRun) await flush();

  logger.info(
    `処理完了: CSV行=${csvLines.toLocaleString()}, parsed=${totalParsed.toLocaleString()}, inserted=${totalInserted.toLocaleString()}, failed=${totalFailed}, errors=${errors.length}`,
  );

  if (errors.length > 0) {
    const errPath = writeErrors(`${SCRIPT_NAME}_errors.csv`, errors.slice(0, 5000));
    logger.warn(`エラーCSV出力(先頭5000件): ${errPath}`);
  }

  if (!args.dryRun) {
    const { count } = await supabase
      .from('activities')
      .select('id', { count: 'exact', head: true });
    logger.info(`DB 件数(最終): ${count?.toLocaleString() ?? 0}`);
  }
}

main().catch((e) => {
  logger.error('予期せぬエラー', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
