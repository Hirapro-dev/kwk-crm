/**
 * Phase 5: 申込 (applications) 取込
 *
 * 入力: csv/moushikomi_csv.csv (約4,395件)
 * 出力: public.applications
 *
 * 仕様:
 *   - 直近6ヶ月の入金日 (payment_date) で絞る (約195件)
 *   - 案件マスタCSV (anken_csv.csv) で {案件名: T-XXX} 辞書を作り、
 *     申込CSVの「投資案件」列を T-XXX に変換して project_id に格納
 *   - 永久担当・申込獲得者: users.full_name 一致 → owner_id/acquirer_id
 *   - 案件固有項目 (コイン数、レート等) は extra jsonb に格納
 *   - member_id / inquiry_id は存在しなければ NULL
 *
 * 前提:
 *   - migration 09 実行済
 *   - projects (anken_csv 投入済)
 *   - members (kaiin_csv 投入済)
 *   - inquiries (kawara + kimitsucp 投入済)
 *
 * 実行: npm run import:applications
 *       npm run import:applications -- --dry-run
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

const APP_CSV = './csv/moushikomi_csv.csv';
const PROJECT_CSV = './csv/anken_csv.csv';
const BATCH_SIZE = 200;

// 直近6ヶ月の境界日
const SIX_MONTHS_AGO = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);

const ALLOWED_STATUS: ReadonlySet<string> = new Set([
  '対応中',
  '未購入',
  '完了',
  '出金',
  '資金移動',
]);
const ALLOWED_FLOW: ReadonlySet<string> = new Set(['入金', '出金', '資金移動', 'W']);

// 共通カラム以外を extra に
const COMMON_KEYS = new Set([
  '投資案件',
  '申込情報ID',
  '問合せ管理ID',
  '申込日',
  'ｽﾃｰﾀｽ',
  '入金/移動',
  '会員ID',
  '会員氏名',
  '会員かな',
  '永久担当',
  '申込獲得者',
  'メールアドレス',
  '契約書送付日',
  '起算月',
  '入金予定日',
  '入金予定額',
  '紹介者名',
  '入金日',
  '入金額',
  '仮想通貨除外分',
  '円金利',
  '郵便番号',
  '住所',
  '資金移動日',
  '資金移動額',
  '資金移動先',
  '出金額',
  '出金日',
  '契約期間',
  '起算日時',
]);

function buildExtra(r: Record<string, string>): Record<string, string> {
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(r)) {
    if (COMMON_KEYS.has(k)) continue;
    const cleaned = nz(v);
    if (cleaned) extra[k] = cleaned;
  }
  return extra;
}

async function main(): Promise<void> {
  const args = parseArgs();
  logger.info('Phase 5: applications 取込', {
    dryRun: args.dryRun,
    base: SIX_MONTHS_AGO.toISOString().slice(0, 10),
  });

  for (const p of [APP_CSV, PROJECT_CSV]) {
    if (!existsSync(resolve(process.cwd(), p))) {
      logger.error(`CSV が見つかりません: ${p}`);
      process.exit(1);
    }
  }

  // ---- 1) 案件マスタCSVから {案件名: T-XXX} 辞書を作成 ----
  const projectsRaw = readCsv(resolve(process.cwd(), PROJECT_CSV), { trimValues: true });
  const projectMap = new Map<string, string>();
  for (const r of projectsRaw) {
    const name = nz(r['案件']);
    const id = nz(r['案件ID']);
    if (name && id) projectMap.set(name, id);
  }
  logger.info(`案件マスタ辞書: ${projectMap.size}件`);

  // ---- 2) users から full_name → id 辞書 ----
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

  // ---- 3) members.id 集合 (FK 解決チェック用、1000件上限のためページネーション) ----
  const memberIds = new Set<string>();
  {
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data, error } = await supabase
        .from('members')
        .select('id')
        .is('deleted_at', null)
        .range(from, from + PAGE - 1);
      if (error) {
        logger.error(`members 取得失敗: ${error.message}`);
        process.exit(1);
      }
      if (!data || data.length === 0) break;
      for (const m of data) memberIds.add(m.id);
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }
  logger.info(`members 取得: ${memberIds.size}件`);

  // ---- 4) inquiries.id 集合 ----
  const inquiryIds = new Set<string>();
  {
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data, error } = await supabase
        .from('inquiries')
        .select('id')
        .is('deleted_at', null)
        .range(from, from + PAGE - 1);
      if (error) {
        logger.error(`inquiries 取得失敗: ${error.message}`);
        process.exit(1);
      }
      if (!data || data.length === 0) break;
      for (const i of data) inquiryIds.add(i.id);
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }
  logger.info(`inquiries 取得: ${inquiryIds.size}件`);

  // ---- 5) CSV → ApplicationRow 変換 (直近6ヶ月絞り) ----
  const rows = readCsv(resolve(process.cwd(), APP_CSV), { trimValues: true });
  logger.info(`CSV読込: ${rows.length}件`);

  const errors: string[] = [];
  const applications: Record<string, unknown>[] = [];

  // 統計
  let skippedOutOfRange = 0;
  let skippedBadId = 0;
  let projectIdResolved = 0;
  let projectIdUnresolved = 0;
  let memberIdNull = 0;
  let inquiryIdNull = 0;

  function resolveOwner(name: string | null): string | null {
    if (!name || name === 'Free') return null;
    const exact = fullNameMap.get(name);
    if (exact) return exact;
    const lastName = name.split(/[\s ]+/)[0];
    if (lastName) return lastNameMap.get(lastName) ?? null;
    return null;
  }

  for (const [i, r] of rows.entries()) {
    const id = nz(r['申込情報ID']);
    if (!id || !/^M-\d{9}$/.test(id)) {
      errors.push(`行${i + 2}: 申込情報ID 形式不正 "${id}"`);
      skippedBadId++;
      continue;
    }

    // 6ヶ月絞り (入金日基準)
    const paymentDate = parseJpDate(nz(r['入金日']));
    if (!paymentDate || new Date(paymentDate) < SIX_MONTHS_AGO) {
      skippedOutOfRange++;
      continue;
    }

    const status = nz(r['ｽﾃｰﾀｽ']);
    const flowType = nz(r['入金/移動']);

    // 案件名 → T-XXX
    const projectName = nz(r['投資案件']);
    let projectId: string | null = null;
    if (projectName) {
      projectId = projectMap.get(projectName) ?? null;
      if (projectId) projectIdResolved++;
      else projectIdUnresolved++;
    }

    // member_id 解決
    const rawMemberId = nz(r['会員ID']);
    let memberId: string | null = null;
    if (rawMemberId && memberIds.has(rawMemberId)) {
      memberId = rawMemberId;
    } else {
      memberIdNull++;
    }

    // inquiry_id 解決 (任意)
    const rawInquiryId = nz(r['問合せ管理ID']);
    let inquiryId: string | null = null;
    if (rawInquiryId && inquiryIds.has(rawInquiryId)) {
      inquiryId = rawInquiryId;
    } else if (rawInquiryId) {
      inquiryIdNull++;
    }

    // 担当者解決
    const ownerNameRaw = nz(r['永久担当']);
    const acquirerNameRaw = nz(r['申込獲得者']);

    // member_id が NULL の場合は applications が members 必須でない場合のみ投入可能。
    // 仕様書 §5.6 では member_id は not null だが、データ実態に合わせ NULL なら skip にする。
    if (!memberId) {
      errors.push(`行${i + 2}: member_id 解決失敗 (会員ID="${rawMemberId}")`);
      continue;
    }

    applications.push({
      id,
      inquiry_id: inquiryId,
      member_id: memberId,
      project_id: projectId,
      application_date: parseJpDate(nz(r['申込日'])) ?? paymentDate,
      status: status && ALLOWED_STATUS.has(status) ? status : null,
      flow_type: flowType && ALLOWED_FLOW.has(flowType) ? flowType : null,
      owner_id: resolveOwner(ownerNameRaw),
      owner_name_raw: ownerNameRaw,
      acquirer_id: resolveOwner(acquirerNameRaw),
      acquirer_name_raw: acquirerNameRaw,
      contract_sent_date: parseJpDate(nz(r['契約書送付日'])),
      start_month: nz(r['起算月']),
      start_datetime: parseJpDateTime(nz(r['起算日時'])),
      scheduled_payment_date: parseJpDate(nz(r['入金予定日'])),
      scheduled_amount: parseAmount(nz(r['入金予定額'])),
      payment_date: paymentDate,
      payment_amount: parseAmount(nz(r['入金額'])),
      crypto_excluded_amount: parseAmount(nz(r['仮想通貨除外分'])),
      yen_interest: parseAmount(nz(r['円金利'])),
      withdrawal_amount: parseAmount(nz(r['出金額'])),
      withdrawal_date: parseJpDate(nz(r['出金日'])),
      transfer_date: parseJpDate(nz(r['資金移動日'])),
      transfer_amount: parseAmount(nz(r['資金移動額'])),
      transfer_to: nz(r['資金移動先']),
      contract_period: nz(r['契約期間']),
      extra: buildExtra(r),
    });
  }

  logger.info(`取込対象: ${applications.length}件`);
  logger.info(`  - 期間外スキップ: ${skippedOutOfRange}`);
  logger.info(`  - ID形式不正スキップ: ${skippedBadId}`);
  logger.info(`  - project_id 解決: ${projectIdResolved} / 未解決: ${projectIdUnresolved}`);
  logger.info(`  - member_id NULLスキップ: ${memberIdNull}`);
  logger.info(`  - inquiry_id NULL (任意): ${inquiryIdNull}`);
  if (errors.length > 0) {
    logger.warn(`エラー ${errors.length}件 (先頭10件):`);
    for (const e of errors.slice(0, 10)) logger.warn(`  ${e}`);
  }

  if (args.dryRun) {
    logger.info('--dry-run: DB 投入はスキップ');
    for (const a of applications.slice(0, 3)) {
      logger.info(
        `  ${JSON.stringify({ id: a.id, member: a.member_id, project: a.project_id, amount: a.payment_amount, date: a.payment_date })}`,
      );
    }
    return;
  }

  // チャンク投入
  const chunks = chunk(applications, BATCH_SIZE);
  let inserted = 0;
  for (const [idx, batch] of chunks.entries()) {
    const { error } = await supabase
      .from('applications')
      .upsert(batch, { onConflict: 'id' });
    if (error) {
      logger.error(`バッチ${idx + 1} 投入失敗: ${error.message}`);
      logger.error(`サンプル: ${JSON.stringify(batch[0])}`);
      process.exit(1);
    }
    inserted += batch.length;
    logger.info(
      `  進捗: ${inserted}/${applications.length} (${Math.round((inserted / applications.length) * 100)}%)`,
    );
  }

  const { count } = await supabase
    .from('applications')
    .select('id', { count: 'exact', head: true });
  logger.info(`✅ 投入完了: DB件数=${count}`);
}

main().catch((e) => {
  logger.error('予期せぬエラー', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
