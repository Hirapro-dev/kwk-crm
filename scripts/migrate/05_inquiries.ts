/**
 * 移行スクリプト 05: 問合せ(inquiries) — 実 CSV 列名対応版
 *
 * 入力: KAWARA版関連.csv + 機密保持_CP.csv
 * 出力: public.inquiries
 *
 * 実 CSV 列(共通):
 *   問合せID / 会員ID / フォーム名 / 広告ID / 氏名 / 氏名かな
 *   郵便番号 / 住所 / メールアドレス / 電話番号 / 登録日時
 *   (それ以外のフォーム固有列は extra に集約)
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseArgs } from './lib/args';
import { chunk } from './lib/chunk';
import { readCsv } from './lib/csv';
import { createMigrateClient } from './lib/db';
import { getEnv } from './lib/env';
import { writeErrors, type ErrorRecord } from './lib/error_writer';
import { loadFormsMap } from './lib/forms_loader';
import { logger, maskEmail, maskPhone } from './lib/logger';
import { normalizeEmail, normalizePhone, nz, parseJpDateTime } from './lib/normalizers';
import { syncExtraFieldDefinitions } from './lib/sync_fields';

const SCRIPT_NAME = '05_inquiries';
const DEFAULT_CSVS = ['KAWARA版関連.csv', '機密保持・CP.csv'];
const BATCH_SIZE = 100;

interface InquiryRow {
  id: string;
  form_id: number | null;
  member_id: string | null;
  name: string | null;
  name_kana: string | null;
  email: string | null;
  phone: string | null;
  postal_code: string | null;
  address: string | null;
  ad_id: string | null;
  extra: Record<string, unknown>;
  registered_at: string;
}

const COMMON_KEYS = new Set([
  '問合せID', '会員ID', 'フォーム名', '広告ID',
  '氏名', '氏名かな', '郵便番号', '住所', 'メールアドレス', '電話番号',
  '登録日時',
]);

function isHashFilled(value: string): boolean {
  return /^#{8,}$/.test(value);
}

function extractExtra(row: Record<string, string>): {
  extra: Record<string, unknown>;
  hashFilledKeys: string[];
} {
  const extra: Record<string, unknown> = {};
  const hashFilledKeys: string[] = [];
  for (const [k, v] of Object.entries(row)) {
    if (!v) continue;
    if (COMMON_KEYS.has(k)) continue;
    if (isHashFilled(v)) {
      hashFilledKeys.push(k);
      continue;
    }
    extra[k] = v;
  }
  return { extra, hashFilledKeys };
}

function transformRow(
  row: Record<string, string>,
  formsMap: Map<string, number>,
  validMemberIds: Set<string>,
): InquiryRow | ErrorRecord {
  const id = nz(row['問合せID']);
  if (!id) return { ...row, _error: '問合せID が空' };

  const registeredAtRaw = row['登録日時'];
  let registeredAt = parseJpDateTime(registeredAtRaw);
  if (!registeredAt) {
    // 登録日時が無い場合は現在時刻でフォールバック
    registeredAt = new Date().toISOString();
  }

  const formName = nz(row['フォーム名']);
  const formId = formName ? (formsMap.get(formName) ?? null) : null;

  // member_id は members に存在するときのみセット
  const memberIdRaw = nz(row['会員ID']);
  const memberId =
    memberIdRaw && validMemberIds.has(memberIdRaw) ? memberIdRaw : null;

  const phoneResult = normalizePhone(row['電話番号']);

  const { extra, hashFilledKeys } = extractExtra(row);

  if (formName && !formId) extra._unmatched_form_name = formName;
  if (memberIdRaw && !memberId) extra._unresolved_member_id = memberIdRaw;
  if (hashFilledKeys.length > 0) extra._hash_filled_columns = hashFilledKeys;
  if (phoneResult.originalIfFlagged) extra._original_phone = phoneResult.originalIfFlagged;

  return {
    id,
    form_id: formId,
    member_id: memberId,
    name: nz(row['氏名']),
    name_kana: nz(row['氏名かな']),
    email: normalizeEmail(row['メールアドレス']),
    phone: phoneResult.phone,
    postal_code: nz(row['郵便番号']),
    address: nz(row['住所']),
    ad_id: nz(row['広告ID']),
    extra,
    registered_at: registeredAt,
  };
}

async function loadValidMemberIds(supabase: ReturnType<typeof createMigrateClient>): Promise<Set<string>> {
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

async function loadOneCsv(
  csvPath: string,
  formsMap: Map<string, number>,
  validMemberIds: Set<string>,
): Promise<{ rows: InquiryRow[]; errors: ErrorRecord[] }> {
  const rows: InquiryRow[] = [];
  const errors: ErrorRecord[] = [];
  if (!existsSync(csvPath)) {
    logger.warn(`CSV未配置(スキップ): ${csvPath}`);
    return { rows, errors };
  }
  const rawRows = readCsv(csvPath, { trimValues: true });
  logger.info(`${csvPath}: ${rawRows.length}行 読込`);
  for (const r of rawRows) {
    const res = transformRow(r, formsMap, validMemberIds);
    if ('id' in res && 'registered_at' in res) {
      rows.push(res);
    } else {
      errors.push(res);
    }
  }
  return { rows, errors };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const env = getEnv();

  const csvPaths = args.file
    ? [resolve(process.cwd(), args.file)]
    : DEFAULT_CSVS.map((f) => resolve(process.cwd(), `${env.sourceDir}/${f}`));

  logger.info(`移行開始: ${SCRIPT_NAME}`, { csvs: csvPaths, dryRun: args.dryRun });

  const supabase = createMigrateClient();
  const formsMap = await loadFormsMap(supabase);
  logger.info(`forms 取得: ${formsMap.size}件`);
  const validMemberIds = await loadValidMemberIds(supabase);
  logger.info(`members 取得: ${validMemberIds.size}件(FK 解決用)`);

  const all: InquiryRow[] = [];
  const errors: ErrorRecord[] = [];
  for (const p of csvPaths) {
    const r = await loadOneCsv(p, formsMap, validMemberIds);
    // 大量件数(10万件超)を push(...arr) するとスタックオーバーフローするためループで追記
    for (const x of r.rows) all.push(x);
    for (const e of r.errors) errors.push(e);
  }

  // ID 重複後勝ち + extra マージ
  const idIndex = new Map<string, number>();
  const dedup: InquiryRow[] = [];
  for (const r of all) {
    const idx = idIndex.get(r.id);
    if (idx === undefined) {
      idIndex.set(r.id, dedup.length);
      dedup.push(r);
    } else {
      errors.push({ id: r.id, _error: '問合せID 重複(後勝ち)' });
      const prev = dedup[idx]!;
      dedup[idx] = { ...r, extra: { ...prev.extra, ...r.extra } };
    }
  }

  if (args.limit) dedup.length = Math.min(dedup.length, args.limit);

  const noForm = dedup.filter((r) => r.form_id === null).length;
  const noMember = dedup.filter((r) => r.member_id === null).length;
  logger.info(`変換完了: 有効=${dedup.length}, エラー=${errors.length}`);
  logger.info(`form_id未解決=${noForm}, member_id未紐付=${noMember}`);

  if (args.dryRun) {
    logger.info('--dry-run: DB 投入はスキップ');
    for (const r of dedup.slice(0, 3)) {
      logger.info(
        '  ' +
          JSON.stringify({
            id: r.id,
            form_id: r.form_id,
            member_id: r.member_id,
            name: r.name,
            email: maskEmail(r.email),
            phone: maskPhone(r.phone),
            extra_keys: Object.keys(r.extra).slice(0, 5),
          }),
      );
    }
    if (errors.length > 0) {
      const errPath = writeErrors(`${SCRIPT_NAME}_errors.csv`, errors);
      logger.warn(`エラーCSV出力: ${errPath}`);
    }
    return;
  }

  const ignoreDup = args.skipExisting;
  logger.info(`投入モード: ${ignoreDup ? '新規のみ(既存スキップ)' : 'upsert(既存更新)'}`);
  const batches = chunk(dedup, BATCH_SIZE);
  let inserted = 0;
  let failed = 0;
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    const { error } = await supabase
      .from('inquiries')
      .upsert(batch, { onConflict: 'id', ignoreDuplicates: ignoreDup });
    if (error) {
      logger.error(`バッチ ${i + 1}/${batches.length} 失敗、1件ずつretry`, {
        message: error.message,
      });
      for (const r of batch) {
        const { error: se } = await supabase
          .from('inquiries')
          .upsert([r], { onConflict: 'id', ignoreDuplicates: ignoreDup });
        if (se) {
          failed++;
          errors.push({ id: r.id, _error: se.message });
        } else {
          inserted++;
        }
      }
    } else {
      inserted += batch.length;
    }
    logger.progress(Math.min((i + 1) * BATCH_SIZE, dedup.length), dedup.length, 'バッチ');
  }
  logger.info(`投入完了: 成功=${inserted}, 失敗=${failed}`);

  if (errors.length > 0) {
    const errPath = writeErrors(`${SCRIPT_NAME}_errors.csv`, errors);
    logger.warn(`エラーCSV出力: ${errPath}`);
  }

  const { count } = await supabase
    .from('inquiries')
    .select('id', { count: 'exact', head: true });
  logger.info(`DB 件数: ${count}`);

  // ヘッダーベースで同期することで、値が空のカラムも登録される
  logger.info('field_definitions を自動同期中...');
  const csvAllHeaders = new Set<string>();
  for (const p of csvPaths) {
    if (!existsSync(p)) continue;
    const headerRows = readCsv(p, { trimValues: true });
    if (headerRows.length > 0) {
      for (const k of Object.keys(headerRows[0]!)) csvAllHeaders.add(k.trim());
    }
  }
  const extraHeaders5 = [...csvAllHeaders].filter((h) => h && !COMMON_KEYS.has(h));
  await syncExtraFieldDefinitions(supabase, 'inquiries', extraHeaders5, args.dryRun);
}

main().catch((e) => {
  logger.error('予期せぬエラー', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
