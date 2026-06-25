/**
 * 単一SQLファイルをservice_roleで実行するユーティリティ
 * 使い方: pnpm tsx scripts/migrate/apply_migration.ts <sqlファイルパス>
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMigrateClient } from './lib/db';

const sqlPath = process.argv[2];
if (!sqlPath) {
  console.error('使い方: pnpm tsx scripts/migrate/apply_migration.ts <sqlファイルパス>');
  process.exit(1);
}

async function main() {
  const sql = readFileSync(resolve(sqlPath), 'utf-8');
  const supabase = createMigrateClient();

  const { error } = await supabase.rpc('exec_sql', { sql });
  if (error) {
    // exec_sql RPC がない場合は直接postgrestでSQLを実行できないため、
    // pg接続を直接使う方法にフォールバック
    console.error('RPC失敗 (exec_sql未定義の可能性):', error.message);
    console.log('\n以下のSQLをSupabase SQL Editorで手動実行してください:');
    console.log('---');
    console.log(sql);
    process.exit(1);
  }
  console.log('適用完了');
}

main().catch(console.error);
