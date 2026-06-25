/**
 * 移行スクリプト 06: 申込情報(applications) — 実 CSV 列名対応版 v3
 * 仕様書 §5.6 §6.1 Phase 2
 *
 * v3: inquiry_id は問合せ投入前は NULL にし、FK 違反を避ける。
 *     問合せ管理ID は extra._inquiry_management_id に証跡保持。
 *     問合せ投入後に別途 SQL でひも付け可能。
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseArgs } from './lib/args';
import { chunk } from './lib/chunk';
import { readCsv } from './lib/csv';
import { createMigrateClient } from './lib/db';
import { getEnv } from './lib/env';
import { writeErrors, type ErrorRecord } from './lib/error_writer';
import { logger } from './lib/logger';
import { nz, parseAmount, parseJpDate, parseJpDateTime } from './lib/normalizers';
import { loadProjectsMap } from './lib/projects_loader';
import { loadUsersForOwnerResolver } from './lib/users_loader';
import { syncExtraFieldDefinitions } from './lib/sync_fields';

const SCRIPT_NAME = '06_applications';
const DEFAULT_CSV = '申し込み情報.csv';
const BATCH_SIZE = 100;

type Status = '対応中' | '未購入' | '完了' | '出金' | '資金移動';
type FlowType = '入金' | '出金' | '資金移動' | 'W';

const ALLOWED_STATUS: ReadonlySet<string> = new Set([
  '対応中',
  '未購入',
  '完了',
  '出金',
  '資金移動',
]);
const ALLOWED_FLOW: ReadonlySet<string> = new Set(['入金', '出金', '資金移動', 'W']);

interface ApplicationRow {
  id: string;
  inquiry_id: string | null;
  member_id: string;
  project_id: number;
  application_date: string;
  status: Status | null;
  flow_type: FlowType | null;
  owner_id: string | null;
  owner_name_raw: string | null;
  acquirer_id: string | null;
  acquirer_name_raw: string | null;
  contract_sent_date: string | null;
  start_month: string | null;
  start_datetime: string | null;
  scheduled_payment_date: string | null;
  scheduled_amount: number | null;
  payment_date: string | null;
  payment_amount: number | null;
  crypto_excluded_amount: number | null;
  yen_interest: number | null;
  withdrawal_amount: number | null;
  withdrawal_date: string | null;
  transfer_date: string | null;
  transfer_amount: number | null;
  transfer_to: string | null;
  contract_period: string | null;
  extra: Record<string, unknown>;
}

const COMMON_KEYS = new Set([
  '申込情報ID', '投資案件', '問合せ管理ID', '申込日', 'ｽﾃｰﾀｽ', '入金/移動',
  '会員ID', '会員氏名', '会員かな', '永久担当', '申込獲得者', 'メールアドレス',
  '契約書送付日', '投資プラン', '起算月', '入金予定日', '入金予定額',
  '入金日', '入金額', '仮想通貨除外分', '円金利', '郵便番号', '住所',
  '資金移動日', '資金移動額', '資金移動先', '起算日時', '出金額', '出金日', '契約期間',
]);

function extractExtra(row: Record<string, string>): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!v) continue;
    if (COMMON_KEYS.has(k)) continue;
    extra[k] = v;
  }
  return extra;
}

interface Resolvers {
  projectsMap: Map<string, number>;
  // biome-ignore lint/suspicious/noExplicitAny: 動的型回避
  ownerResolver: any;
  validInquiryIds: Set<string>;
}

function transformRow(
  row: Record<string, string>,
  resolvers: Resolvers,
): ApplicationRow | ErrorRecord {
  const id = nz(row['申込情報ID']);
  if (!id) return { ...row, _error: '申込情報ID が空' };

  const memberId = nz(row['会員ID']);
  if (!memberId) return { ...row, _error: '会員ID が空' };

  const projectName = nz(row['投資案件']);
  if (!projectName) return { ...row, _error: '投資案件 が空' };
  const projectId = resolvers.projectsMap.get(projectName);
  if (!projectId) return { ...row, _error: `案件マスタにない: ${projectName}` };

  const applicationDate = parseJpDate(row['申込日']);
  if (!applicationDate) return { ...row, _error: '申込日が空または不正' };

  const statusRaw = nz(row['ｽﾃｰﾀｽ']);
  const status = statusRaw && ALLOWED_STATUS.has(statusRaw) ? (statusRaw as Status) : null;
  const flowRaw = nz(row['入金/移動']);
  const flowType = flowRaw && ALLOWED_FLOW.has(flowRaw) ? (flowRaw as FlowType) : null;

  const ownerNameRaw = nz(row['永久担当']);
  const acquirerNameRaw = nz(row['申込獲得者']);
  const ownerUser = ownerNameRaw ? resolvers.ownerResolver.resolve(ownerNameRaw) : null;
  const acquirerUser = acquirerNameRaw
    ? resolvers.ownerResolver.resolve(acquirerNameRaw)
    : null;

  // 問合せ管理ID は inquiries に存在するときのみセット、なければ extra に保持
  const inquiryIdRaw = nz(row['問合せ管理ID']);
  let inquiryId: string | null = null;
  const extra = extractExtra(row);
  if (inquiryIdRaw) {
    if (resolvers.validInquiryIds.has(inquiryIdRaw)) {
      inquiryId = inquiryIdRaw;
    } else {
      extra._inquiry_management_id = inquiryIdRaw;
    }
  }

  if (statusRaw && !status) extra._invalid_status = statusRaw;
  if (flowRaw && !flowType) extra._invalid_flow_type = flowRaw;

  return {
    id,
    inquiry_id: inquiryId,
    member_id: memberId,
    project_id: projectId,
    application_date: applicationDate,
    status,
    flow_type: flowType,
    owner_id: ownerUser?.id ?? null,
    owner_name_raw: ownerNameRaw,
    acquirer_id: acquirerUser?.id ?? null,
    acquirer_name_raw: acquirerNameRaw,
    contract_sent_date: parseJpDate(row['契約書送付日']),
    start_month: nz(row['起算月']),
    start_datetime: parseJpDateTime(row['起算日時']),
    scheduled_payment_date: parseJpDate(row['入金予定日']),
    scheduled_amount: parseAmount(row['入金予定額']),
    payment_date: parseJpDate(row['入金日']),
    payment_amount: parseAmount(row['入金額']),
    crypto_excluded_amount: parseAmount(row['仮想通貨除外分']),
    yen_interest: parseAmount(row['円金利']),
    withdrawal_amount: parseAmount(row['出金額']),
    withdrawal_date: parseJpDate(row['出金日']),
    transfer_date: parseJpDate(row['資金移動日']),
    transfer_amount: parseAmount(row['資金移動額']),
    transfer_to: nz(row['資金移動先']),
    contract_period: nz(row['契約期間']),
    extra,
  };
}

async function loadValidInquiryIds(supabase: ReturnType<typeof createMigrateClient>): Promise<Set<string>> {
  const ids = new Set<string>();
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('inquiries')
      .select('id')
      .range(from, from + PAGE - 1);
    if (error) {
      logger.warn(`inquiries 取得失敗(空とみなす): ${error.message}`);
      return ids;
    }
    if (!data || data.length === 0) break;
    for (const r of data) ids.add(r.id as string);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return ids;
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

  const supabase = createMigrateClient();
  const projectsMap = await loadProjectsMap(supabase);
  logger.info(`projects 取得: ${projectsMap.size}件`);
  const { resolver: ownerResolver } = await loadUsersForOwnerResolver(supabase);
  logger.info(`users resolver 構築完了`);
  const validInquiryIds = await loadValidInquiryIds(supabase);
  logger.info(`inquiries 取得: ${validInquiryIds.size}件(FK解決用)`);

  const resolvers: Resolvers = { projectsMap, ownerResolver, validInquiryIds };

  const rawRows = readCsv(csvPath, { trimValues: true });
  logger.info(`CSV読込: ${rawRows.length}件`);

  const errors: ErrorRecord[] = [];
  const tmpRows: ApplicationRow[] = [];
  for (const r of rawRows) {
    const res = transformRow(r, resolvers);
    if ('id' in res && 'member_id' in res) {
      tmpRows.push(res);
    } else {
      errors.push(res);
    }
  }

  const idIndex = new Map<string, number>();
  const validRows: ApplicationRow[] = [];
  for (const r of tmpRows) {
    const idx = idIndex.get(r.id);
    if (idx === undefined) {
      idIndex.set(r.id, validRows.length);
      validRows.push(r);
    } else {
      errors.push({ id: r.id, _error: '申込ID 重複(後勝ち)' });
      validRows[idx] = r;
    }
  }

  if (args.limit) validRows.length = Math.min(validRows.length, args.limit);

  const statusDist = validRows.reduce<Record<string, number>>((acc, r) => {
    const k = r.status ?? '(null)';
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  const withInquiry = validRows.filter((r) => r.inquiry_id).length;
  logger.info(`変換完了: 有効=${validRows.length}, エラー=${errors.length}`);
  logger.info(`inquiry_id解決済み=${withInquiry}, 未解決(extra保持)=${validRows.length - withInquiry}`);
  logger.info(`ステータス分布`, statusDist);

  if (args.dryRun) {
    logger.info('--dry-run: DB 投入はスキップ');
    return;
  }

  const batches = chunk(validRows, BATCH_SIZE);
  let inserted = 0;
  let failed = 0;
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    const { error } = await supabase
      .from('applications')
      .upsert(batch, { onConflict: 'id', ignoreDuplicates: false });
    if (error) {
      logger.error(`バッチ ${i + 1}/${batches.length} 失敗、1件ずつretry`, {
        message: error.message,
      });
      for (const r of batch) {
        const { error: se } = await supabase
          .from('applications')
          .upsert([r], { onConflict: 'id' });
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
    logger.progress(Math.min((i + 1) * BATCH_SIZE, validRows.length), validRows.length, 'バッチ');
  }
  logger.info(`投入完了: 成功=${inserted}, 失敗=${failed}`);

  if (errors.length > 0) {
    const errPath = writeErrors(`${SCRIPT_NAME}_errors.csv`, errors);
    logger.warn(`エラーCSV出力: ${errPath}`);
  }

  const { count } = await supabase
    .from('applications')
    .select('id', { count: 'exact', head: true });
  logger.info(`DB 件数: ${count}`);

  // ヘッダーベースで同期することで、値が空のカラムも登録される
  logger.info('field_definitions を自動同期中...');
  const allCsvHeaders6 = rawRows.length > 0 ? Object.keys(rawRows[0]!) : [];
  const extraHeaders6 = allCsvHeaders6
    .map((h) => h.trim())
    .filter((h) => h && !COMMON_KEYS.has(h));
  await syncExtraFieldDefinitions(supabase, 'applications', extraHeaders6, args.dryRun);
}

main().catch((e) => {
  logger.error('予期せぬエラー', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
