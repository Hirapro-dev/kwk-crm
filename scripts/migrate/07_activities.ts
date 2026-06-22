/**
 * 移行スクリプト 07: 活動履歴(activities) — 実 CSV 列名対応版
 *
 * 入力: extract.csv (対応歴.csv)
 * 出力: public.activities
 *
 * 実 CSV 列:
 *   AccountId / Dbunrui__c / Mbunrui__c / Sbunrui__c / Description
 *   tourokunitiji__c / WhatId / CreatedById / OwnerId / WhoId
 *   ActivityDate / ActivityDateTime
 *
 * Id 列が無いため、CSV 行番号 + ハッシュで legacy_sf_id を生成。
 * WhoId は空欄が多いため、member_id は基本 NULL。
 * OwnerId はサニタイズ済み人名なので、resolver で解決を試みる。
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseArgs } from './lib/args';
import { streamCsv } from './lib/csv_stream';
import { createMigrateClient } from './lib/db';
import { getEnv } from './lib/env';
import { writeErrors, type ErrorRecord } from './lib/error_writer';
import { logger } from './lib/logger';
import { nz, parseJpDate, parseJpDateTime } from './lib/normalizers';
import { loadUsersForOwnerResolver } from './lib/users_loader';
import type { OwnerResolver } from './lib/owner_resolver';
import type { MigrateClient } from './lib/db';

const SCRIPT_NAME = '07_activities';
const DEFAULT_CSV = 'extract.csv';
const BATCH_SIZE = 500;
const PROGRESS_EVERY = 500;

interface ActivityRow {
  legacy_sf_id: string;
  owner_id: string | null;
  member_id: string | null;
  created_by_id: string | null;
  duration_minutes: number | null;
  description: string | null;
  d_bunrui: string | null;
  m_bunrui: string | null;
  s_bunrui: string | null;
  registered_date: string | null;
  registered_datetime: string | null;
}

function genLegacyId(row: Record<string, string>, index: number): string {
  // 行内容 + index でハッシュ生成
  const key = JSON.stringify(row) + index;
  return `act_${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
}

function transformRow(
  row: Record<string, string>,
  ownerResolver: OwnerResolver,
  validMemberIds: Set<string>,
  index: number,
): ActivityRow | ErrorRecord {
  const legacy = genLegacyId(row, index);

  const ownerName = nz(row['OwnerId']);
  const createdByName = nz(row['CreatedById']);
  const ownerUser = ownerName ? ownerResolver.resolve(ownerName) : null;
  const createdByUser = createdByName ? ownerResolver.resolve(createdByName) : null;

  const whoId = nz(row['WhoId']);
  const memberId = whoId && validMemberIds.has(whoId) ? whoId : null;

  return {
    legacy_sf_id: legacy,
    owner_id: ownerUser?.id ?? null,
    member_id: memberId,
    created_by_id: createdByUser?.id ?? null,
    duration_minutes: null,
    description: nz(row['Description']),
    d_bunrui: nz(row['Dbunrui__c']),
    m_bunrui: nz(row['Mbunrui__c']),
    s_bunrui: nz(row['Sbunrui__c']),
    registered_date: parseJpDate(row['ActivityDate']),
    registered_datetime: parseJpDateTime(
      row['tourokunitiji__c'] || row['ActivityDateTime'],
    ),
  };
}

async function loadValidMemberIds(supabase: MigrateClient): Promise<Set<string>> {
  const ids = new Set<string>();
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('members')
      .select('id')
      .range(from, from + PAGE - 1);
    if (error) return ids;
    if (!data || data.length === 0) break;
    for (const r of data) ids.add(r.id as string);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return ids;
}

async function flushBatch(
  supabase: MigrateClient,
  batch: ActivityRow[],
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
  const { resolver: ownerResolver } = await loadUsersForOwnerResolver(supabase);
  logger.info('users resolver 構築完了');
  const validMemberIds = await loadValidMemberIds(supabase);
  logger.info(`members 取得: ${validMemberIds.size}件(FK解決用)`);

  const errors: ErrorRecord[] = [];
  let buffer: ActivityRow[] = [];
  let totalInserted = 0;
  let totalFailed = 0;
  let totalParsed = 0;
  let csvLines = 0;
  const startedAt = Date.now();

  await streamCsv(
    csvPath,
    async (row) => {
      csvLines++;
      if (args.limit && totalParsed >= args.limit) return;

      const res = transformRow(row, ownerResolver, validMemberIds, totalParsed);
      if (!('legacy_sf_id' in res)) {
        errors.push(res);
        return;
      }
      totalParsed++;
      buffer.push(res);

      if (buffer.length >= BATCH_SIZE && !args.dryRun) {
        const result = await flushBatch(supabase, buffer, errors);
        totalInserted += result.inserted;
        totalFailed += result.failed;
        buffer = [];
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

  if (!args.dryRun && buffer.length > 0) {
    const result = await flushBatch(supabase, buffer, errors);
    totalInserted += result.inserted;
    totalFailed += result.failed;
  }

  logger.info(
    `処理完了: CSV行=${csvLines.toLocaleString()}, parsed=${totalParsed.toLocaleString()}, inserted=${totalInserted.toLocaleString()}, failed=${totalFailed}, errors=${errors.length}`,
  );

  if (errors.length > 0) {
    const errPath = writeErrors(`${SCRIPT_NAME}_errors.csv`, errors);
    logger.warn(`エラーCSV出力: ${errPath}`);
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
