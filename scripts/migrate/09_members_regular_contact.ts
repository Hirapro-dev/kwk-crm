/**
 * 移行スクリプト 09: 定期連絡者 (regular_contact_id) を members に反映
 *
 * 入力CSV: extract.csv (顧客情報DB)
 *   列: Name, Id, Member_ID__c, teiki__c
 *
 * マッピング:
 *   Member_ID__c (K-XXXXXXX) → members.id
 *   teiki__c (Salesforce User ID) → users.legacy_sf_id → users.id → members.regular_contact_id
 *
 * --dry-run: DB変更なし
 */

import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';

import { createMigrateClient } from './lib/db';
import { logger } from './lib/logger';

const DEFAULT_CSV = '/Users/takaya/Desktop/csv/extract.csv';
const CHUNK_SIZE = 200;

function parseCliArgs() {
  const argv = process.argv.slice(2);
  return {
    dryRun: argv.includes('--dry-run'),
    file:   (() => { const i = argv.indexOf('--file'); return i >= 0 ? argv[i + 1] : undefined; })(),
  };
}

/** BOM除去・シンプルCSVパーサ */
async function* parseCsv(filePath: string): AsyncGenerator<Record<string, string>> {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  let headers: string[] | null = null;
  let isFirst = true;

  for await (const rawLine of rl) {
    let line = rawLine;
    if (isFirst) {
      if (line.charCodeAt(0) === 0xfeff) line = line.slice(1);
      isFirst = false;
    }
    const cells = line.match(/("(?:[^"]|"")*"|[^,]*)/g)
      ?.map(c => c.startsWith('"') ? c.slice(1, -1).replace(/""/g, '"') : c) ?? [];

    if (!headers) { headers = cells; continue; }
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (cells[i] ?? '').trim(); });
    yield row;
  }
}

async function main() {
  const args = parseCliArgs();
  const csvPath = args.file ?? DEFAULT_CSV;

  if (!existsSync(csvPath)) {
    logger.error(`CSV not found: ${csvPath}`);
    process.exit(1);
  }
  logger.info(`CSV: ${csvPath}`);

  const sb = createMigrateClient();

  // Salesforce UserID → users.id マップを構築
  logger.info('Loading users (legacy_sf_id)...');
  const sfIdToUserId = new Map<string, string>();
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from('users')
      .select('id, legacy_sf_id, full_name')
      .not('legacy_sf_id', 'is', null)
      .range(from, from + 999);
    if (error) { logger.error('users load error: ' + error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    for (const u of data as { id: string; legacy_sf_id: string; full_name: string | null }[]) {
      if (u.legacy_sf_id) sfIdToUserId.set(u.legacy_sf_id, u.id);
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  logger.info(`User map: ${sfIdToUserId.size} entries`);

  // CSV を処理: (member_id, regular_contact_id) ペアを収集
  // teiki__c が空の行はスキップ(nullにしたい場合は別途対応)
  const updates: { memberId: string; userId: string }[] = [];
  let totalRows = 0;
  let skipped = 0;
  let notResolved = 0;

  for await (const row of parseCsv(csvPath)) {
    totalRows++;
    const memberId = row['Member_ID__c']?.trim();
    const sfUserId = row['teiki__c']?.trim();

    if (!memberId || !sfUserId) { skipped++; continue; }

    const userId = sfIdToUserId.get(sfUserId);
    if (!userId) {
      notResolved++;
      logger.warn(`Unresolved teiki__c: ${sfUserId} (member=${memberId})`);
      continue;
    }

    updates.push({ memberId, userId });
  }

  logger.info(`CSV: total=${totalRows}, updates=${updates.length}, skipped(empty)=${skipped}, unresolved=${notResolved}`);

  if (args.dryRun) {
    logger.info('[DRY RUN] DB変更は実施しません');
    logger.info(`更新予定: ${updates.length}件`);
    return;
  }

  // グループ化: userId → memberIds[] でまとめてUPDATE
  const byUser = new Map<string, string[]>();
  for (const { memberId, userId } of updates) {
    if (!byUser.has(userId)) byUser.set(userId, []);
    byUser.get(userId)!.push(memberId);
  }

  let updated = 0;
  let failed = 0;

  for (const [userId, memberIds] of byUser) {
    // チャンク分割
    for (let i = 0; i < memberIds.length; i += CHUNK_SIZE) {
      const chunk = memberIds.slice(i, i + CHUNK_SIZE);
      const { error } = await sb
        .from('members')
        .update({ regular_contact_id: userId })
        .in('id', chunk)
        .is('deleted_at', null);

      if (error) {
        logger.error(`UPDATE failed (userId=${userId}): ${error.message}`);
        failed += chunk.length;
      } else {
        updated += chunk.length;
      }
    }
  }

  // teiki__cが空の会員はNULLにリセット(任意: 今回は更新対象のみ)

  logger.info('=== 完了 ===');
  logger.info(`更新成功: ${updated}件`);
  logger.info(`更新失敗: ${failed}件`);
}

main().catch(e => { logger.error(e); process.exit(1); });
