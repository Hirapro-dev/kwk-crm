/**
 * 移行スクリプト 01: 従業員(users)
 * 仕様書 §4.1 §5.1 §6.1 Phase 1 マスタ移行
 *
 * 入力: User2.csv (約102件)
 * 出力: public.users
 *
 * 想定列(Salesforceエクスポート):
 *   Id              : legacy_sf_id
 *   Email           : email
 *   FirstName       : first_name
 *   LastName        : last_name
 *   Name            : full_name(Salesforce では氏名)
 *   IsActive        : is_active
 *   UserRole.Name   : role の参考(マッピング)
 *
 * 重要な制約:
 *   - public.users.id は uuid (auth.users.id と一致させる前提)
 *   - 本移行時点では auth.users は未登録のため、各 user に uuid を新規発番し、
 *     legacy_sf_id で旧IDを紐付ける。
 *   - 後日、各人に Supabase Auth の招待を送り、メールが一致するレコードに対して
 *     auth.users.id ↔ public.users.id を一致させる手順(別タスク)を踏む。
 *
 * 実行:
 *   pnpm migrate:users -- --dry-run
 *   pnpm migrate:users -- --file ./csv/User2.csv
 */

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { parseArgs } from './lib/args';
import { readCsv } from './lib/csv';
import { createMigrateClient } from './lib/db';
import { getEnv } from './lib/env';
import { writeErrors, type ErrorRecord } from './lib/error_writer';
import { logger, maskEmail } from './lib/logger';
import { chunk } from './lib/chunk';
import { nz, parseBool } from './lib/normalizers';

const SCRIPT_NAME = '01_users';
const DEFAULT_CSV = 'User2.csv';
const BATCH_SIZE = 100;

interface UserRow {
  id: string;
  legacy_sf_id: string | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  is_active: boolean;
  role: 'admin' | 'manager' | 'sales' | 'viewer';
}

/**
 * Salesforce の UserRole.Name をシステムロールにマッピング。
 * 仕様書 §7.1 の4ロールに正規化する。
 * 不明な場合は viewer (最小権限)。admin への昇格は後から管理画面で行う。
 */
function mapRole(roleName: string | null | undefined): UserRow['role'] {
  if (!roleName) return 'viewer';
  const r = roleName.toLowerCase();
  if (r.includes('admin') || r.includes('管理')) return 'admin';
  if (r.includes('manager') || r.includes('マネージャ') || r.includes('役員')) return 'manager';
  if (r.includes('sales') || r.includes('営業')) return 'sales';
  return 'viewer';
}

/**
 * 入力行を UserRow に変換。失敗時は ErrorRecord を返す。
 */
function transformRow(row: Record<string, string>): UserRow | ErrorRecord {
  // Salesforce 標準列名の候補をいくつか拾う
  const legacy = nz(row['Id'] ?? row['ユーザーID'] ?? row['legacy_sf_id']);
  const email = nz(row['Email'] ?? row['メール'] ?? row['email']);
  const firstName = nz(row['FirstName'] ?? row['名']);
  const lastName = nz(row['LastName'] ?? row['姓']);
  const fullName =
    nz(row['Name'] ?? row['氏名'] ?? row['full_name']) ??
    (lastName && firstName ? `${lastName} ${firstName}` : (lastName ?? firstName ?? null));
  const isActive = row['IsActive'] !== undefined ? parseBool(row['IsActive']) : true;
  const roleSource = nz(row['UserRole.Name'] ?? row['role'] ?? row['権限']);

  if (!email) {
    return { ...row, _error: 'email is missing' };
  }

  return {
    id: randomUUID(),
    legacy_sf_id: legacy,
    email: email.toLowerCase(),
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    is_active: isActive,
    role: mapRole(roleSource),
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const env = getEnv();
  const csvPath = resolve(process.cwd(), args.file ?? `${env.sourceDir}/${DEFAULT_CSV}`);

  logger.info(`移行開始: ${SCRIPT_NAME}`, {
    csv: csvPath,
    dryRun: args.dryRun,
  });

  if (!existsSync(csvPath)) {
    logger.error(`CSVが見つかりません: ${csvPath}`);
    process.exit(1);
  }

  const rawRows = readCsv(csvPath, { trimValues: true });
  logger.info(`CSV読込完了: ${rawRows.length}件`);

  // 変換 + エラー振り分け
  const validRows: UserRow[] = [];
  const errors: ErrorRecord[] = [];
  for (const r of rawRows) {
    const result = transformRow(r);
    if ('id' in result && 'role' in result) {
      validRows.push(result);
    } else {
      errors.push(result);
    }
  }

  // メール重複チェック(CSV内)
  const seen = new Map<string, number>();
  const filtered: UserRow[] = [];
  for (const r of validRows) {
    const c = seen.get(r.email);
    if (c !== undefined) {
      errors.push({ email: r.email, legacy_sf_id: r.legacy_sf_id ?? '', _error: 'duplicate email in CSV' });
      continue;
    }
    seen.set(r.email, 1);
    filtered.push(r);
  }

  if (args.limit) {
    filtered.length = Math.min(filtered.length, args.limit);
  }

  logger.info(`変換結果: 有効=${filtered.length}, エラー=${errors.length}`);

  if (args.dryRun) {
    logger.info('--dry-run 指定のため DB 投入はスキップします');
    logger.info('サンプル先頭3件:');
    for (const r of filtered.slice(0, 3)) {
      logger.info('  ' + JSON.stringify({ ...r, email: maskEmail(r.email) }));
    }
    if (errors.length > 0) {
      const errPath = writeErrors(`${SCRIPT_NAME}_errors.csv`, errors);
      logger.warn(`エラーCSV出力: ${errPath}`);
    }
    return;
  }

  // ===== 本投入 =====
  const supabase = createMigrateClient();
  // legacy_sf_id をキーに UPSERT(冪等)。
  // ただし新規発番した id (uuid) が legacy 紐付け済みのレコードと衝突しないよう、
  //   ON CONFLICT (legacy_sf_id) を利用する想定。
  // supabase-js では .upsert({}, { onConflict: 'legacy_sf_id' }) でOK。

  let inserted = 0;
  let failed = 0;

  const batches = chunk(filtered, BATCH_SIZE);
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b]!;
    const { error } = await supabase
      .from('users')
      .upsert(batch, { onConflict: 'legacy_sf_id', ignoreDuplicates: false });

    if (error) {
      logger.error(`バッチ ${b + 1}/${batches.length} 失敗`, { message: error.message });
      // メール重複等の制約違反を 1行ずつ retry してエラー記録
      for (const r of batch) {
        const { error: singleErr } = await supabase
          .from('users')
          .upsert([r], { onConflict: 'legacy_sf_id' });
        if (singleErr) {
          failed++;
          errors.push({
            legacy_sf_id: r.legacy_sf_id ?? '',
            email: r.email,
            _error: singleErr.message,
          });
        } else {
          inserted++;
        }
      }
    } else {
      inserted += batch.length;
    }
    logger.progress((b + 1) * BATCH_SIZE, filtered.length, 'バッチ');
  }

  logger.info(`投入完了: 成功=${inserted}, 失敗=${failed}, CSV件数=${rawRows.length}`);

  if (errors.length > 0) {
    const errPath = writeErrors(`${SCRIPT_NAME}_errors.csv`, errors);
    logger.warn(`エラーCSV出力: ${errPath}`);
  }

  // 件数検証(仕様書 §6.4)
  const { count, error: countErr } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true });
  if (countErr) {
    logger.warn(`件数取得エラー: ${countErr.message}`);
  } else {
    logger.info(`DB 件数: ${count}`);
  }
}

main().catch((e) => {
  logger.error('予期せぬエラー', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
