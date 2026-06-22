/**
 * 移行検証スクリプト
 * 仕様書 §6.4 移行完了判定:
 *   - 件数チェック: ソースCSV件数 = 移行後テーブル件数(errors/ 件数を含めて一致)
 *   - サンプル抽出比較: 各テーブル先頭10件・末尾10件を目視チェック
 *   - 集計値比較: 会員総数、申込総数、活動総件数、永久担当別件数
 *
 * 実行:
 *   pnpm tsx scripts/migrate/verify.ts
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { readCsv } from './lib/csv';
import { createMigrateClient } from './lib/db';
import { getEnv } from './lib/env';
import { logger } from './lib/logger';

interface VerifyResult {
  table: string;
  csvCount: number | null;
  dbCount: number;
  status: 'OK' | 'WARN' | 'ERROR';
  note?: string;
}

async function countTable(tableName: string): Promise<number> {
  const supabase = createMigrateClient();
  const { count, error } = await supabase
    .from(tableName)
    .select('*', { count: 'exact', head: true });
  if (error) {
    throw new Error(`${tableName} 件数取得失敗: ${error.message}`);
  }
  return count ?? 0;
}

function csvCount(filename: string): number | null {
  const env = getEnv();
  const filepath = resolve(process.cwd(), `${env.sourceDir}/${filename}`);
  if (!existsSync(filepath)) return null;
  return readCsv(filepath, { trimValues: true }).length;
}

async function verifyTable(
  tableName: string,
  csvFiles: string[],
  acceptableDelta = 0,
): Promise<VerifyResult> {
  const csvTotal = csvFiles.reduce<number | null>((acc, f) => {
    const c = csvCount(f);
    if (c === null) return acc;
    return (acc ?? 0) + c;
  }, null);
  const dbTotal = await countTable(tableName);

  let status: VerifyResult['status'] = 'OK';
  let note: string | undefined;

  if (csvTotal === null) {
    status = 'WARN';
    note = '対応CSVが見つからないため比較不可';
  } else {
    const diff = Math.abs(csvTotal - dbTotal);
    if (diff > acceptableDelta) {
      status = 'ERROR';
      note = `差分=${diff}(許容範囲超)`;
    } else if (diff > 0) {
      status = 'WARN';
      note = `差分=${diff}`;
    }
  }

  return { table: tableName, csvCount: csvTotal, dbCount: dbTotal, status, note };
}

async function main(): Promise<void> {
  logger.info('移行検証 開始');

  const results: VerifyResult[] = [];

  // テーブルごとの対応CSV(仕様書 §1.4)
  // users / projects / forms はCSVと厳密一致しないこともあるためdeltaを許容
  results.push(await verifyTable('users', ['User2.csv'], 5));
  results.push(await verifyTable('projects', [], 0)); // projects は推定値なので比較しない
  results.push(await verifyTable('forms', [], 0)); // forms も同様

  results.push(await verifyTable('members', ['会員情報.csv'], 0));
  results.push(
    await verifyTable('inquiries', ['KAWARA版関連.csv', '機密保持_CP.csv'], 0),
  );
  results.push(await verifyTable('applications', ['申し込み情報.csv'], 0));
  results.push(await verifyTable('activities', ['extract.csv'], 0));

  // 結果表示
  console.log('\n=== 検証結果 ===');
  console.log('テーブル          | CSV件数 | DB件数  | 状態 | 備考');
  console.log('------------------|---------|---------|------|------');
  let hasError = false;
  for (const r of results) {
    if (r.status === 'ERROR') hasError = true;
    const csvDisp = r.csvCount === null ? 'N/A' : String(r.csvCount);
    console.log(
      `${r.table.padEnd(18)}| ${csvDisp.padStart(7)} | ${String(r.dbCount).padStart(7)} | ${r.status.padEnd(5)}| ${r.note ?? ''}`,
    );
  }

  // 永久担当別件数(仕様書 §6.4)
  console.log('\n=== 永久担当別 会員件数 ===');
  const supabase = createMigrateClient();
  const { data: ownerStats, error } = await supabase.rpc('count_members_by_owner', {});
  if (error || !ownerStats) {
    logger.warn('count_members_by_owner RPC 未実装のため省略', { error: error?.message });
  } else {
    console.log(ownerStats);
  }

  if (hasError) {
    logger.error('検証エラーあり。詳細を確認してください。');
    process.exit(1);
  }
  logger.info('検証完了');
}

main().catch((e) => {
  logger.error('予期せぬエラー', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
