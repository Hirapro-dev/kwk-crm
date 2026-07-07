/**
 * 会員に「XELS/SCT インサイダークラブ入会日」を取込 (migration 56, CLAUDE.md §5.4)
 *
 * 入力: extract.csv (Salesforce 由来)
 *   ヘッダー: Id, Member_ID__c, Name, XELSインサイダークラブ入会日, SCTインサイダークラブ入会日
 * 出力: public.members の xels_insider_joined_at / sct_insider_joined_at のみ更新
 *
 * 方針 (ユーザー承認済):
 *   - 会員ID (Member_ID__c = K-XXXXXXX) で既存 members と突合。
 *   - 更新対象は「XELS/SCT のどちらかに値がある」かつ「既存 members に存在する」行のみ。
 *   - 氏名など他カラムは一切触らない (id + 2日付のみ upsert)。
 *   - 新規会員は作らない。DB に存在しない K-ID はスキップしてログに残す。
 *
 * 実行:
 *   npm run import:members:insider -- --dry-run
 *   npm run import:members:insider
 *   npm run import:members:insider -- --file /path/to/extract.csv --limit 100
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseArgs } from '../migrate/lib/args';
import { readCsv } from '../migrate/lib/csv';
import { createMigrateClient } from '../migrate/lib/db';
import { logger } from '../migrate/lib/logger';
import { parseJpDate } from '../migrate/lib/normalizers';

const CSV_PATH = '/Users/takaya/Desktop/csv/extract.csv';
const CONCURRENCY = 20; // 個別 UPDATE の並列数

const H_ID = 'Member_ID__c';
const H_XELS = 'XELSインサイダークラブ入会日';
const H_SCT = 'SCTインサイダークラブ入会日';

function nz(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

interface UpdateRow {
  id: string;
  xels_insider_joined_at: string | null;
  sct_insider_joined_at: string | null;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const csvPath = resolve(process.cwd(), args.file ?? CSV_PATH);

  logger.info('会員インサイダー入会日 取込', {
    csv: csvPath,
    dryRun: args.dryRun,
    limit: args.limit,
  });
  if (!existsSync(csvPath)) {
    logger.error(`CSV が見つかりません: ${csvPath}`);
    process.exit(1);
  }

  const rows = readCsv(csvPath, { trimValues: true });
  logger.info(`CSV読込: ${rows.length}件`);

  // ヘッダー存在チェック (想定外フォーマットで黙って空更新するのを防ぐ)
  const headers = new Set(Object.keys(rows[0] ?? {}));
  for (const h of [H_ID, H_XELS, H_SCT]) {
    if (!headers.has(h)) {
      logger.error(`必須列が見つかりません: "${h}" / 実際のヘッダー: ${[...headers].join(', ')}`);
      process.exit(1);
    }
  }

  // 既存 members の id 集合を取得 (存在するIDのみ更新するため)
  const supabase = createMigrateClient();
  const existingIds = new Set<string>();
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from('members')
      .select('id')
      .is('deleted_at', null)
      .range(from, from + page - 1);
    if (error) {
      logger.error(`members 取得失敗: ${error.message}`);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    for (const d of data) existingIds.add(d.id as string);
    if (data.length < page) break;
    from += page;
  }
  logger.info(`既存 members(未削除): ${existingIds.size}件`);

  // CSV → 更新レコード変換
  const targetRows = args.limit ? rows.slice(0, args.limit) : rows;
  const updates: UpdateRow[] = [];
  let skipNoDate = 0; // 日付が両方空 → 更新不要
  let skipBadId = 0; // K-ID 形式不正
  const notInDb: string[] = []; // DB に存在しない
  const notInDbWithDate: UpdateRow[] = []; // DB に無いが日付あり (取りこぼし注意)

  for (const [i, r] of targetRows.entries()) {
    const id = nz(r[H_ID]);
    if (!id || !/^K-\d{9}$/.test(id)) {
      skipBadId++;
      if (skipBadId <= 5) logger.warn(`行${i + 2}: 会員ID 形式不正 "${id}"`);
      continue;
    }
    const xels = parseJpDate(nz(r[H_XELS]));
    const sct = parseJpDate(nz(r[H_SCT]));
    if (xels === null && sct === null) {
      skipNoDate++;
      continue;
    }
    if (!existingIds.has(id)) {
      notInDb.push(id);
      notInDbWithDate.push({ id, xels_insider_joined_at: xels, sct_insider_joined_at: sct });
      continue;
    }
    updates.push({ id, xels_insider_joined_at: xels, sct_insider_joined_at: sct });
  }

  logger.info('集計:', {
    更新対象: updates.length,
    日付なしスキップ: skipNoDate,
    ID不正スキップ: skipBadId,
    DBに無くスキップ: notInDb.length,
    うち日付ありで取りこぼし: notInDbWithDate.length,
  });
  if (notInDbWithDate.length > 0) {
    logger.warn(`日付ありだが DB に存在しないためスキップ (${notInDbWithDate.length}件):`);
    for (const n of notInDbWithDate.slice(0, 20)) logger.warn(`  ${JSON.stringify(n)}`);
  }

  const xelsCount = updates.filter((u) => u.xels_insider_joined_at).length;
  const sctCount = updates.filter((u) => u.sct_insider_joined_at).length;
  logger.info(`更新後に値が入る見込み: XELS=${xelsCount}件 / SCT=${sctCount}件`);

  if (args.dryRun) {
    logger.info('--dry-run: DB 更新はスキップ');
    for (const u of updates.slice(0, 5)) logger.info(`  ${JSON.stringify(u)}`);
    return;
  }

  // 2日付のみを個別 UPDATE (氏名など他カラムに触れないため upsert は使わない)。
  // 既存IDのみ対象なので新規行は作られない。並列度を上げて 3千件強を高速に処理。
  let done = 0;
  let failed = 0;
  for (let i = 0; i < updates.length; i += CONCURRENCY) {
    const slice = updates.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      slice.map((u) =>
        supabase
          .from('members')
          .update({
            xels_insider_joined_at: u.xels_insider_joined_at,
            sct_insider_joined_at: u.sct_insider_joined_at,
          })
          .eq('id', u.id)
          .is('deleted_at', null),
      ),
    );
    results.forEach((res, j) => {
      const row = slice[j];
      if (res.error) {
        failed++;
        if (failed <= 5 && row) logger.error(`${row.id} 更新失敗: ${res.error.message}`);
      } else {
        done++;
      }
    });
    if (i % (CONCURRENCY * 20) === 0 || i + CONCURRENCY >= updates.length) {
      logger.info(
        `  進捗: ${done + failed}/${updates.length} (${Math.round(((done + failed) / updates.length) * 100)}%)`,
      );
    }
  }
  logger.info(`更新結果: 成功=${done}件 / 失敗=${failed}件`);

  // 検証: 実DBの非NULL件数
  const { count: xelsDb } = await supabase
    .from('members')
    .select('id', { count: 'exact', head: true })
    .not('xels_insider_joined_at', 'is', null);
  const { count: sctDb } = await supabase
    .from('members')
    .select('id', { count: 'exact', head: true })
    .not('sct_insider_joined_at', 'is', null);
  logger.info(`✅ 更新完了: DB非NULL件数 XELS=${xelsDb} / SCT=${sctDb}`);
}

main().catch((e) => {
  logger.error('予期せぬエラー', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
