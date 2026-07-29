/**
 * 会員に「備考」を取込 (migration 70, CLAUDE.md §5.4)
 *
 * 入力: extract.csv (Salesforce 由来)
 *   ヘッダー: 会員ID, 備考
 * 出力: public.members の remarks のみ更新
 *
 * 方針 (ユーザー承認済):
 *   - 会員ID (K-XXXXXXXXX) で既存 members と突合。
 *   - 更新対象は「備考に値がある」かつ「既存 members に存在する」行のみ。
 *     備考が空の行は既存値に触らない (初回取込のため上書き消去はしない)。
 *   - 氏名など他カラムは一切触らない (remarks のみ個別 UPDATE)。
 *   - 新規会員は作らない。DB に存在しない K-ID はスキップしてログに残す。
 *
 * 実行:
 *   npm run import:members:remarks -- --dry-run
 *   npm run import:members:remarks
 *   npm run import:members:remarks -- --file /path/to/extract.csv --limit 100
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseArgs } from '../migrate/lib/args';
import { readCsv } from '../migrate/lib/csv';
import { createMigrateClient } from '../migrate/lib/db';
import { logger } from '../migrate/lib/logger';

const CSV_PATH = '/Users/takaya/Desktop/csv/extract.csv';
const CONCURRENCY = 20; // 個別 UPDATE の並列数

const H_ID = '会員ID';
const H_REMARKS = '備考';

function nz(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

interface UpdateRow {
  id: string;
  remarks: string;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const csvPath = resolve(process.cwd(), args.file ?? CSV_PATH);

  logger.info('会員 備考 取込', {
    csv: csvPath,
    dryRun: args.dryRun,
    limit: args.limit,
  });
  if (!existsSync(csvPath)) {
    logger.error(`CSV が見つかりません: ${csvPath}`);
    process.exit(1);
  }

  // trimValues は使わない (備考内の改行・体裁を保持。先頭末尾の空白のみ nz() で処理)
  const rows = readCsv(csvPath);
  logger.info(`CSV読込: ${rows.length}件`);

  // ヘッダー存在チェック (想定外フォーマットで黙って空更新するのを防ぐ)
  const headers = new Set(Object.keys(rows[0] ?? {}));
  for (const h of [H_ID, H_REMARKS]) {
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
  let skipEmpty = 0; // 備考が空 → 更新不要
  let skipBadId = 0; // K-ID 形式不正
  const notInDb: string[] = []; // DB に存在しない
  const notInDbWithRemarks: UpdateRow[] = []; // DB に無いが備考あり (取りこぼし注意)

  for (const [i, r] of targetRows.entries()) {
    const id = nz(r[H_ID]);
    if (!id || !/^K-\d{9}$/.test(id)) {
      skipBadId++;
      if (skipBadId <= 5) logger.warn(`行${i + 2}: 会員ID 形式不正 "${id}"`);
      continue;
    }
    const remarks = nz(r[H_REMARKS]);
    if (remarks === null) {
      skipEmpty++;
      continue;
    }
    if (!existingIds.has(id)) {
      notInDb.push(id);
      notInDbWithRemarks.push({ id, remarks });
      continue;
    }
    updates.push({ id, remarks });
  }

  logger.info('集計:', {
    更新対象: updates.length,
    備考なしスキップ: skipEmpty,
    ID不正スキップ: skipBadId,
    DBに無くスキップ: notInDb.length,
  });
  if (notInDbWithRemarks.length > 0) {
    logger.warn(`備考ありだが DB に存在しないためスキップ (${notInDbWithRemarks.length}件):`);
    for (const n of notInDbWithRemarks.slice(0, 20)) logger.warn(`  ${JSON.stringify(n)}`);
  }

  if (args.dryRun) {
    logger.info('--dry-run: DB 更新はスキップ');
    for (const u of updates.slice(0, 5)) logger.info(`  ${JSON.stringify(u)}`);
    return;
  }

  // remarks のみを個別 UPDATE (氏名など他カラムに触れないため upsert は使わない)。
  // 既存IDのみ対象なので新規行は作られない。
  let done = 0;
  let failed = 0;
  for (let i = 0; i < updates.length; i += CONCURRENCY) {
    const slice = updates.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      slice.map((u) =>
        supabase.from('members').update({ remarks: u.remarks }).eq('id', u.id).is('deleted_at', null),
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
  const { count: remarksDb } = await supabase
    .from('members')
    .select('id', { count: 'exact', head: true })
    .not('remarks', 'is', null);
  logger.info(`✅ 更新完了: DB非NULL件数 remarks=${remarksDb}`);
}

main().catch((e) => {
  logger.error('予期せぬエラー', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
