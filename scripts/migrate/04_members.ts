/**
 * 移行スクリプト 04: 会員(members) — 実 CSV 列名対応版
 * 仕様書 §5.4 §6.1 Phase 2
 *
 * 入力: 会員情報.csv
 * 出力: public.members
 *
 * 実 CSV の列名:
 *   会員ID / 永久担当 / 実質名義人 / 会員氏名 / 会員かな
 *   Eメール1 / Eメール2 / Eメール3 / 電話番号1 / 住所(フル）
 *   顧客種別 / 総合計額 / 総合計実入金額 / 広告ID / 広告媒体名
 *   個人情報取得ポイント / 顧客情報取得日 / メルマガ登録日時 / 登録日
 *   総利用額合計 / 案件別 利用額・出金額 多数(extra に集約)
 *
 * クレンジング(仕様書 §6.3):
 *   - 電話番号フラグ抽出
 *   - email 空文字→null
 *   - 永久担当 "Free" → owner_id NULL
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseArgs } from './lib/args';
import { chunk } from './lib/chunk';
import { readCsv } from './lib/csv';
import { createMigrateClient } from './lib/db';
import { getEnv } from './lib/env';
import { writeErrors, type ErrorRecord } from './lib/error_writer';
import { logger, maskEmail, maskPhone } from './lib/logger';
import {
  normalizeEmail,
  normalizePhone,
  nz,
  parseAmount,
  parseJpDate,
  parseJpDateTime,
} from './lib/normalizers';
import { loadUsersForOwnerResolver } from './lib/users_loader';

const SCRIPT_NAME = '04_members';
const DEFAULT_CSV = '会員情報.csv';
const BATCH_SIZE = 100;

interface MemberRow {
  id: string;
  name: string;
  name_kana: string | null;
  real_name: string | null;
  email1: string | null;
  email2: string | null;
  email3: string | null;
  phone1: string | null;
  do_not_call: boolean;
  address: string | null;
  postal_code: string | null;
  customer_type: string | null;
  owner_id: string | null;
  owner_name_raw: string | null;
  registered_at: string | null;
  mailmag_registered_at: string | null;
  ad_id: string | null;
  ad_medium: string | null;
  info_acquired_points: string | null;
  info_acquired_date: string | null;
  total_amount: number | null;
  total_paid_amount: number | null;
  total_used_amount: number | null;
  extra: Record<string, unknown>;
}

/**
 * 会員ID をそのまま使う(CSV由来は K-XXXXXXX 形式またはランダム文字列、両方 text として OK)
 */
export function normalizeMemberId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  return s === '' ? null : s;
}

/**
 * 案件別利用額・出金額の列を一つの JSONB に集約
 */
function extractLegacyBreakdown(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!v) continue;
    if (k.includes('利用額') || k.includes('出金額') || k.includes('購入金額')) {
      out[k] = v;
    }
  }
  return out;
}

function transformRow(row: Record<string, string>): MemberRow | ErrorRecord {
  const id = normalizeMemberId(row['会員ID']);
  if (!id) {
    return { ...row, _error: '会員ID が空' };
  }

  // 会員氏名(必須)。空なら実質名義人をフォールバックに使う。
  let name = nz(row['会員氏名']) ?? nz(row['実質名義人']);
  if (!name) {
    // 氏名が完全に無いレコードはエラー(name は NOT NULL)
    return { ...row, _error: '会員氏名が空' };
  }

  const phoneResult = normalizePhone(row['電話番号1']);

  const registeredAt =
    parseJpDateTime(row['登録日']) ?? parseJpDate(row['登録日']);
  const mailmagAt = parseJpDateTime(row['メルマガ登録日時']);

  const ownerNameRaw = nz(row['永久担当']);

  const legacyBreakdown = extractLegacyBreakdown(row);

  const extra: Record<string, unknown> = {};
  if (Object.keys(legacyBreakdown).length > 0) extra.legacy_breakdown = legacyBreakdown;
  if (phoneResult.originalIfFlagged) extra.original_phone1 = phoneResult.originalIfFlagged;
  // 「メルマガ登録~会員登録」「総合計実入金額」など参考にしたい値も extra に
  for (const key of ['メルマガ登録~会員登録', '総合計実入金額']) {
    if (row[key]) extra[key] = row[key];
  }

  return {
    id,
    name,
    name_kana: nz(row['会員かな']),
    real_name: nz(row['実質名義人']),
    email1: normalizeEmail(row['Eメール1']),
    email2: normalizeEmail(row['Eメール2']),
    email3: normalizeEmail(row['Eメール3']),
    phone1: phoneResult.phone,
    do_not_call: phoneResult.doNotCall,
    address: nz(row['住所(フル）']),
    postal_code: null, // 元 CSV に独立した郵便番号列がない
    customer_type: nz(row['顧客種別']),
    owner_id: null, // 後で resolver で埋める
    owner_name_raw: ownerNameRaw,
    registered_at: registeredAt
      ? registeredAt.length === 10
        ? `${registeredAt}T00:00:00+09:00`
        : registeredAt
      : null,
    mailmag_registered_at: mailmagAt,
    ad_id: nz(row['広告ID']),
    ad_medium: nz(row['広告媒体名']),
    info_acquired_points: nz(row['個人情報取得ポイント']),
    info_acquired_date: parseJpDate(row['顧客情報取得日']),
    total_amount: parseAmount(row['総合計額']),
    total_paid_amount: parseAmount(row['総合計実入金額']),
    total_used_amount: parseAmount(row['総利用額合計']),
    extra,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const env = getEnv();
  const csvPath = resolve(process.cwd(), args.file ?? `${env.sourceDir}/${DEFAULT_CSV}`);

  logger.info(`移行開始: ${SCRIPT_NAME}`, { csv: csvPath, dryRun: args.dryRun });

  if (!existsSync(csvPath)) {
    logger.error(`CSVが見つかりません: ${csvPath}`);
    process.exit(1);
  }

  const rawRows = readCsv(csvPath, { trimValues: true });
  logger.info(`CSV読込完了: ${rawRows.length}件`);

  const errors: ErrorRecord[] = [];
  const tmpRows: MemberRow[] = [];
  for (const r of rawRows) {
    const res = transformRow(r);
    if ('id' in res && 'name' in res) {
      tmpRows.push(res);
    } else {
      errors.push(res);
    }
  }

  // ID 重複(後勝ち)
  const seen = new Map<string, number>();
  const validRows: MemberRow[] = [];
  for (const r of tmpRows) {
    if (seen.has(r.id)) {
      errors.push({ id: r.id, name: r.name, _error: '会員ID 重複(後勝ち)' });
      const idx = validRows.findIndex((v) => v.id === r.id);
      if (idx >= 0) validRows[idx] = r;
      continue;
    }
    seen.set(r.id, 1);
    validRows.push(r);
  }

  // 永久担当 → owner_id 解決
  const supabase = createMigrateClient();
  const { resolver } = await loadUsersForOwnerResolver(supabase);
  logger.info('users resolver 構築完了');

  let resolved = 0;
  let unresolved = 0;
  for (const r of validRows) {
    if (!r.owner_name_raw) continue;
    const u = resolver.resolve(r.owner_name_raw);
    if (u) {
      r.owner_id = u.id;
      resolved++;
    } else {
      unresolved++;
    }
  }
  logger.info(`永久担当解決: 成功=${resolved}, Free/未解決=${unresolved}`);

  if (args.limit) validRows.length = Math.min(validRows.length, args.limit);
  logger.info(`変換完了: 有効=${validRows.length}, エラー=${errors.length}`);

  if (args.dryRun) {
    logger.info('--dry-run: DB 投入はスキップ');
    logger.info('サンプル先頭3件:');
    for (const r of validRows.slice(0, 3)) {
      logger.info(
        '  ' +
          JSON.stringify({
            id: r.id,
            name: r.name,
            email1: maskEmail(r.email1),
            phone1: maskPhone(r.phone1),
            owner_id: r.owner_id,
            owner_name_raw: r.owner_name_raw,
            total_amount: r.total_amount,
            extra_keys: Object.keys(r.extra),
          }),
      );
    }
    if (errors.length > 0) {
      const errPath = writeErrors(`${SCRIPT_NAME}_errors.csv`, errors);
      logger.warn(`エラーCSV出力: ${errPath}`);
    }
    return;
  }

  // バッチ投入
  const batches = chunk(validRows, BATCH_SIZE);
  let inserted = 0;
  let failed = 0;
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    const { error } = await supabase
      .from('members')
      .upsert(batch, { onConflict: 'id', ignoreDuplicates: false });
    if (error) {
      logger.error(`バッチ ${i + 1}/${batches.length} 失敗、1件ずつ retry`, {
        message: error.message,
      });
      for (const r of batch) {
        const { error: se } = await supabase.from('members').upsert([r], { onConflict: 'id' });
        if (se) {
          failed++;
          errors.push({ id: r.id, name: r.name, _error: se.message });
        } else {
          inserted++;
        }
      }
    } else {
      inserted += batch.length;
    }
    logger.progress(Math.min((i + 1) * BATCH_SIZE, validRows.length), validRows.length, 'バッチ');
  }
  logger.info(`投入完了: 成功=${inserted}, 失敗=${failed}`);

  if (errors.length > 0) {
    const errPath = writeErrors(`${SCRIPT_NAME}_errors.csv`, errors);
    logger.warn(`エラーCSV出力: ${errPath}`);
  }

  const { count, error: cntErr } = await supabase
    .from('members')
    .select('id', { count: 'exact', head: true });
  if (cntErr) logger.warn(`件数取得エラー: ${cntErr.message}`);
  else logger.info(`DB 件数: ${count}`);
}

main().catch((e) => {
  logger.error('予期せぬエラー', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
