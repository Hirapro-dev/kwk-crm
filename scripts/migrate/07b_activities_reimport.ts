/**
 * 移行スクリプト 07b: 活動履歴(activities) 再インポート
 *
 * 新CSVフォーマット (2026-06版):
 *   対応歴ID, 会員ID, プロテクト, 接触種別, 接触内容, 状態, 登録日時, Description
 *
 * カラムマッピング:
 *   対応歴ID  → legacy_sf_id   (TO-XXXXXXX)
 *   会員ID    → member_id      (K-XXXXXXX)
 *   プロテクト → owner_id       (users へ名前解決、free/空はNULL)
 *   接触種別  → m_bunrui
 *   接触内容  → d_bunrui
 *   状態      → s_bunrui
 *   登録日時  → registered_datetime / registered_date
 *   Description → description
 *
 * --dry-run: DB変更なし、件数確認のみ
 * --no-truncate: 既存データ削除をスキップして UPSERT のみ実行
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { streamCsv } from './lib/csv_stream';
import { createMigrateClient } from './lib/db';
import { getEnv } from './lib/env';
import { writeErrors, type ErrorRecord } from './lib/error_writer';
import { logger } from './lib/logger';
import { nz, parseJpDateTime } from './lib/normalizers';
import { loadUsersForOwnerResolver } from './lib/users_loader';

const SCRIPT_NAME = '07b_activities_reimport';
const DEFAULT_CSV = 'extract.csv';
const BATCH_SIZE = 500;
const PROGRESS_EVERY = 5000;

interface ActivityRow {
  legacy_sf_id: string;
  owner_id: string | null;
  member_id: string | null;
  d_bunrui: string | null;
  m_bunrui: string | null;
  s_bunrui: string | null;
  description: string | null;
  registered_date: string | null;
  registered_datetime: string | null;
}

function parseCliArgs() {
  const argv = process.argv.slice(2);
  return {
    dryRun:     argv.includes('--dry-run'),
    noTruncate: argv.includes('--no-truncate'),
    file:       (() => { const i = argv.indexOf('--file'); return i >= 0 ? argv[i + 1] : undefined; })(),
  };
}

async function main() {
  const args = parseCliArgs();
  const env = getEnv();
  const csvPath = resolve(env.sourceDir, args.file ?? DEFAULT_CSV);

  if (!existsSync(csvPath)) {
    logger.error(`CSV not found: ${csvPath}`);
    process.exit(1);
  }
  logger.info(`CSV: ${csvPath}`);

  const sb = createMigrateClient();

  // ユーザー一覧を取得してオーナー解決器を構築
  const { users, resolver } = await loadUsersForOwnerResolver(sb);
  logger.info(`Loaded ${users.length} users for name resolution`);

  // 有効な会員IDセットを全件ページネーションで構築
  // Supabase デフォルト上限は1000件のため、必ずページングする
  logger.info('Loading valid member IDs (paginated)...');
  const validMemberIds = new Set<string>();
  const PAGE_SIZE = 1000;
  let from = 0;
  while (true) {
    const { data, error: memberErr } = await sb
      .from('members')
      .select('id')
      .is('deleted_at', null)
      .range(from, from + PAGE_SIZE - 1);
    if (memberErr) {
      logger.error('Failed to load members: ' + memberErr.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    for (const r of data as { id: string }[]) validMemberIds.add(r.id);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  logger.info(`Valid members: ${validMemberIds.size}`);

  // --- 既存データ削除 (バッチ方式) ---
  if (args.dryRun) {
    logger.info('[DRY RUN] DB変更は実施しません');
  } else if (!args.noTruncate) {
    logger.info('Deleting existing activities (batch)...');
    let deleted = 0;
    const DEL_BATCH = 5000;
    while (true) {
      // IDを取得してそのIDで削除(タイムアウト回避)
      const { data: ids, error: selErr } = await sb
        .from('activities')
        .select('id')
        .limit(DEL_BATCH);
      if (selErr) { logger.error('SELECT failed: ' + selErr.message); process.exit(1); }
      if (!ids || ids.length === 0) break;

      const idList = ids.map((r: { id: number }) => r.id);
      const { error: delErr } = await sb
        .from('activities')
        .delete()
        .in('id', idList);
      if (delErr) { logger.error('DELETE failed: ' + delErr.message); process.exit(1); }

      deleted += idList.length;
      logger.info(`Deleted ${deleted.toLocaleString()} rows...`);
    }
    logger.info(`Delete complete. Total deleted: ${deleted.toLocaleString()}`);
  }

  // --- CSV 取込 ---
  let total = 0;
  const errors: ErrorRecord[] = [];
  let batch: ActivityRow[] = [];
  let upserted = 0;
  let skipped = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    if (args.dryRun) { batch = []; return; }

    const { error } = await sb
      .from('activities')
      .upsert(batch, { onConflict: 'legacy_sf_id', ignoreDuplicates: false });

    if (error) {
      logger.error(`Batch upsert failed (batch start legacy_id=${batch[0]?.legacy_sf_id}): ${error.message}`);
      for (const row of batch) {
        errors.push({ id: row.legacy_sf_id, error: error.message, raw: JSON.stringify(row) });
      }
      skipped += batch.length;
    } else {
      upserted += batch.length;
    }
    batch = [];
  };

  await streamCsv(csvPath, async (row) => {
    total++;

    const legacyId = nz(row['対応歴ID']);
    if (!legacyId) {
      errors.push({ id: `row_${total}`, error: '対応歴IDが空', raw: JSON.stringify(row) });
      skipped++;
      return;
    }

    const rawMemberId = nz(row['会員ID']);
    const memberId = rawMemberId && validMemberIds.has(rawMemberId) ? rawMemberId : null;

    const protectName = nz(row['プロテクト']);
    const ownerUser = protectName ? resolver.resolve(protectName) : null;

    const rawDatetime = nz(row['登録日時']);
    const registeredDatetime = rawDatetime ? parseJpDateTime(rawDatetime) : null;
    const registeredDate = registeredDatetime ? registeredDatetime.slice(0, 10) : null;

    batch.push({
      legacy_sf_id:        legacyId,
      owner_id:            ownerUser?.id ?? null,
      member_id:           memberId,
      d_bunrui:            nz(row['接触内容']),
      m_bunrui:            nz(row['接触種別']),
      s_bunrui:            nz(row['状態']),
      description:         nz(row['Description']),
      registered_date:     registeredDate,
      registered_datetime: registeredDatetime,
    });

    if (batch.length >= BATCH_SIZE) await flush();

    if (total % PROGRESS_EVERY === 0) {
      logger.info(`Progress: ${total.toLocaleString()} rows (upserted=${upserted.toLocaleString()}, skip=${skipped})`);
    }
  });

  await flush();

  if (errors.length > 0) {
    await writeErrors(SCRIPT_NAME, errors);
    logger.warn(`エラーファイル出力済: errors/${SCRIPT_NAME}_*.csv`);
  }

  logger.info('=== 完了 ===');
  logger.info(`総行数    : ${total.toLocaleString()}`);
  logger.info(`投入済    : ${upserted.toLocaleString()}`);
  logger.info(`スキップ  : ${skipped.toLocaleString()}`);
  logger.info(`エラー件数: ${errors.length.toLocaleString()}`);
  if (args.dryRun) logger.info('[DRY RUN] DB変更は実施されていません');
}

main().catch((e) => {
  logger.error(e);
  process.exit(1);
});
