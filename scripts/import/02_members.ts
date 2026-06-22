/**
 * Phase 3: 会員 (members) 取込
 *
 * 入力: csv/kaiin_csv.csv (全件、約23,580件)
 * 出力: public.members
 *
 * 仕様:
 *   - 全件取込 (FK 解決のため 6ヶ月絞りなし)
 *   - 案件別利用額の170列は無視 (extra に保存もしない、容量削減)
 *   - phone1 末尾の「架電NG」を do_not_call=true に分離
 *   - 永久担当: users.full_name 一致 → owner_id、それ以外は owner_name_raw に保持
 *
 * 前提:
 *   - migration 09 実行済 (members は TRUNCATE 済)
 *   - users テーブルに sales 11名 + admin 登録済
 *
 * 実行: npm run import:members
 *       npm run import:members -- --dry-run
 *       npm run import:members -- --limit 100  (テスト用)
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseArgs } from '../migrate/lib/args';
import { chunk } from '../migrate/lib/chunk';
import { readCsv } from '../migrate/lib/csv';
import { createMigrateClient } from '../migrate/lib/db';
import { logger } from '../migrate/lib/logger';
import {
  nz,
  parseAmount,
  parseJpDate,
  parseJpDateTime,
} from '../migrate/lib/normalizers';

const CSV_PATH = './csv/kaiin_csv.csv';
const BATCH_SIZE = 500;

interface MemberRow {
  id: string;
  name: string | null;
  name_kana: string | null;
  real_name: string | null;
  email1: string | null;
  email2: string | null;
  email3: string | null;
  phone1: string | null;
  do_not_call: boolean;
  address: string | null;
  customer_type: string | null;
  owner_id: string | null;
  owner_name_raw: string | null;
  first_contact_date: string | null;
  registered_at: string | null;
  mailmag_registered_at: string | null;
  ad_id: string | null;
  ad_medium: string | null;
  info_acquired_points: string | null;
  info_acquired_date: string | null;
  gender: string | null;
  birthdate: string | null;
  referrer_name: string | null;
  affiliate_id: string | null;
  affiliate_name: string | null;
  total_amount: number | null;
  total_paid_amount: number | null;
  total_used_amount: number | null;
}

/**
 * phone1 末尾の「架電NG」を分離。
 * 「08034396967架電NG」→ { phone: "08034396967", doNotCall: true }
 */
function parsePhone(raw: string | null): { phone: string | null; doNotCall: boolean } {
  if (!raw) return { phone: null, doNotCall: false };
  const t = raw.trim();
  if (!t) return { phone: null, doNotCall: false };
  // 「架電NG」「(架電NG)」「（架電NG）」を末尾から除去
  const m = t.match(/^(.*?)(?:[（(]?架電NG[）)]?)?$/);
  if (m && m[1] !== t) {
    return { phone: m[1].trim() || null, doNotCall: true };
  }
  // 末尾に「架電NG」が混入しているケース全般
  if (/架電NG/.test(t)) {
    const cleaned = t.replace(/[（(]?架電NG[）)]?/g, '').trim();
    return { phone: cleaned || null, doNotCall: true };
  }
  return { phone: t, doNotCall: false };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const csvPath = resolve(process.cwd(), args.file ?? CSV_PATH);

  logger.info('Phase 3: members 取込', { csv: csvPath, dryRun: args.dryRun, limit: args.limit });
  if (!existsSync(csvPath)) {
    logger.error(`CSV が見つかりません: ${csvPath}`);
    process.exit(1);
  }
  const rows = readCsv(csvPath, { trimValues: true });
  logger.info(`CSV読込: ${rows.length}件`);

  // users 一覧取得 (owner 解決用)
  const supabase = createMigrateClient();
  const { data: users, error: uErr } = await supabase
    .from('users')
    .select('id, full_name, last_name')
    .is('deleted_at', null);
  if (uErr) {
    logger.error(`users 取得失敗: ${uErr.message}`);
    process.exit(1);
  }
  const fullNameMap = new Map<string, string>();
  const lastNameMap = new Map<string, string>();
  for (const u of users ?? []) {
    if (u.full_name) fullNameMap.set(u.full_name, u.id);
    if (u.last_name) lastNameMap.set(u.last_name, u.id);
  }
  logger.info(`users 取得: ${fullNameMap.size}件`);

  // CSV → MemberRow 変換
  const targetRows = args.limit ? rows.slice(0, args.limit) : rows;
  const members: MemberRow[] = [];
  const errors: string[] = [];

  for (const [i, r] of targetRows.entries()) {
    const id = nz(r['会員ID']);
    if (!id || !/^K-\d{9}$/.test(id)) {
      errors.push(`行${i + 2}: 会員ID 形式不正 "${id}"`);
      continue;
    }

    const phoneRaw = nz(r['電話番号1']);
    const { phone, doNotCall } = parsePhone(phoneRaw);

    const ownerNameRaw = nz(r['永久担当']);
    let ownerId: string | null = null;
    if (ownerNameRaw && ownerNameRaw !== 'Free') {
      ownerId = fullNameMap.get(ownerNameRaw) ?? null;
      if (!ownerId) {
        // 姓のみ一致でフォールバック (例: "植田" → "植田 雄輝")
        const lastName = ownerNameRaw.split(/[\s ]+/)[0];
        if (lastName) ownerId = lastNameMap.get(lastName) ?? null;
      }
    }

    members.push({
      id,
      name: nz(r['会員氏名']),
      name_kana: nz(r['会員かな']),
      real_name: nz(r['実質名義人']),
      email1: nz(r['Eメール1']),
      email2: nz(r['Eメール2']),
      email3: nz(r['Eメール3']),
      phone1: phone,
      do_not_call: doNotCall,
      address: nz(r['住所(フル）']) ?? nz(r['住所(フル)']),
      customer_type: nz(r['顧客種別']),
      owner_id: ownerId,
      owner_name_raw: ownerNameRaw,
      first_contact_date: parseJpDate(nz(r['初回接触日'])),
      registered_at: parseJpDateTime(nz(r['登録日'])),
      mailmag_registered_at: parseJpDateTime(nz(r['メルマガ登録日時'])),
      ad_id: nz(r['広告ID']),
      ad_medium: nz(r['広告媒体名']),
      info_acquired_points: nz(r['個人情報取得ポイント']),
      info_acquired_date: parseJpDate(nz(r['顧客情報取得日'])),
      gender: nz(r['性別']),
      birthdate: parseJpDate(nz(r['生年月日'])),
      referrer_name: nz(r['紹介者氏名']),
      affiliate_id: nz(r['ｱﾌｨﾘID']) ?? nz(r['アフィリID']),
      affiliate_name: nz(r['アフィリ名']),
      total_amount: parseAmount(nz(r['総合計額'])),
      total_paid_amount: parseAmount(nz(r['総合計実入金額'])),
      total_used_amount: parseAmount(nz(r['総利用額合計'])),
    });
  }

  if (errors.length > 0) {
    logger.warn(`変換エラー ${errors.length}件 (先頭10件):`);
    for (const e of errors.slice(0, 10)) logger.warn(`  ${e}`);
  }

  logger.info(`投入対象: ${members.length}件`);
  const ownedCount = members.filter((m) => m.owner_id).length;
  logger.info(`owner_id 解決: ${ownedCount}件 (${members.length - ownedCount}件は owner_name_raw のみ)`);

  if (args.dryRun) {
    logger.info('--dry-run: DB 投入はスキップ');
    for (const m of members.slice(0, 5)) {
      logger.info(`  ${JSON.stringify({ id: m.id, name: m.name, owner: m.owner_id, total: m.total_amount })}`);
    }
    return;
  }

  // チャンク投入
  const chunks = chunk(members, BATCH_SIZE);
  let inserted = 0;
  for (const [idx, batch] of chunks.entries()) {
    const { error } = await supabase
      .from('members')
      .upsert(batch, { onConflict: 'id' });
    if (error) {
      logger.error(`バッチ${idx + 1} 投入失敗: ${error.message}`);
      logger.error(`サンプル: ${JSON.stringify(batch[0])}`);
      process.exit(1);
    }
    inserted += batch.length;
    if ((idx + 1) % 5 === 0 || idx === chunks.length - 1) {
      logger.info(`  進捗: ${inserted}/${members.length} (${Math.round((inserted / members.length) * 100)}%)`);
    }
  }

  const { count } = await supabase
    .from('members')
    .select('id', { count: 'exact', head: true });
  logger.info(`✅ 投入完了: DB件数=${count}`);
}

main().catch((e) => {
  logger.error('予期せぬエラー', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
