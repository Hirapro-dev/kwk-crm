/**
 * Phase 4: 問合せ (inquiries) 取込
 *
 * 入力:
 *   - csv/kawara_scv.csv (KAWARA問合せ 約3,121件)
 *   - csv/kimitsucp_csv.csv (機密保持CP問合せ 約717件)
 *
 * 出力:
 *   - public.forms (フォームマスタ自動生成)
 *   - public.inquiries (両CSV 統合)
 *
 * 仕様:
 *   - 全件取込 (FK 解決のため 6ヶ月絞りなし)
 *   - 「###...#」(7文字以上の#連続) は空文字に置換 (仕様書 §6.3)
 *   - フォームマスタは name で重複排除し serial 採番 (CSV出現順)
 *   - 共通カラム以外は extra jsonb に格納
 *
 * 前提:
 *   - migration 09 実行済 (inquiries は TRUNCATE 済)
 *   - forms テーブルは既存 (まずクリアして再構築)
 *
 * 実行: npm run import:inquiries
 *       npm run import:inquiries -- --dry-run
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseArgs } from '../migrate/lib/args';
import { chunk } from '../migrate/lib/chunk';
import { readCsv } from '../migrate/lib/csv';
import { createMigrateClient } from '../migrate/lib/db';
import { logger } from '../migrate/lib/logger';
import { nz, parseJpDateTime } from '../migrate/lib/normalizers';

const KAWARA_CSV = './csv/kawara_scv.csv';
const KIMITSUCP_CSV = './csv/kimitsucp_csv.csv';
const BATCH_SIZE = 500;

const HASH_PLACEHOLDER_REGEX = /^#{7,}$/;

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
  extra: Record<string, string>;
  registered_at: string | null;
  source_category: string; // どちらのCSV由来か (forms.category 用)
}

/** ###...# 大量埋め文字を空に置換、その他は値そのまま */
function cleanValue(v: string | null): string | null {
  if (!v) return v;
  if (HASH_PLACEHOLDER_REGEX.test(v)) return null;
  return v;
}

/** 共通カラム以外を extra jsonb に格納する */
function extractExtra(
  r: Record<string, string>,
  excludeKeys: Set<string>,
): Record<string, string> {
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(r)) {
    if (excludeKeys.has(k)) continue;
    const cleaned = cleanValue(nz(v));
    if (cleaned) extra[k] = cleaned;
  }
  return extra;
}

// 共通カラム (inquiries テーブルの通常カラムに格納するもの)
// これら以外は extra jsonb 行き
const COMMON_KEYS = new Set([
  '問合せID',
  '会員ID',
  'フォーム名',
  '広告ID',
  '氏名',
  '氏名かな',
  '郵便番号',
  '住所',
  'メールアドレス',
  '電話番号',
  '登録日時',
]);

async function main(): Promise<void> {
  const args = parseArgs();
  logger.info('Phase 4: inquiries 取込', { dryRun: args.dryRun });

  for (const p of [KAWARA_CSV, KIMITSUCP_CSV]) {
    if (!existsSync(resolve(process.cwd(), p))) {
      logger.error(`CSV が見つかりません: ${p}`);
      process.exit(1);
    }
  }

  const kawara = readCsv(resolve(process.cwd(), KAWARA_CSV), { trimValues: true });
  const kimitsucp = readCsv(resolve(process.cwd(), KIMITSUCP_CSV), { trimValues: true });
  logger.info(`KAWARA: ${kawara.length}件 / 機密保持CP: ${kimitsucp.length}件`);

  // ---- 0) DB から既存 members.id 一覧を取得 (FK 解決のため) ----
  //         Supabase は 1回の SELECT 上限 1000件のため、ページネーションで取得
  const supabaseForCheck = createMigrateClient();
  const memberIds = new Set<string>();
  let from = 0;
  const PAGE_SIZE = 1000;
  while (true) {
    const { data, error } = await supabaseForCheck
      .from('members')
      .select('id')
      .is('deleted_at', null)
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      logger.error(`members.id 取得失敗: ${error.message}`);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    for (const m of data) memberIds.add(m.id);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  logger.info(`既存 members.id: ${memberIds.size}件`);

  // ---- 1) フォームマスタ生成 ----
  const formMap = new Map<string, { id: number; category: string }>(); // name → {id, category}
  let formIdCounter = 1;

  function registerForm(name: string, category: string): number {
    let entry = formMap.get(name);
    if (!entry) {
      entry = { id: formIdCounter++, category };
      formMap.set(name, entry);
    }
    return entry.id;
  }

  // ---- 2) CSV → InquiryRow ----
  const inquiries: InquiryRow[] = [];
  const errors: string[] = [];
  let memberIdMissingCount = 0;

  function convertRow(
    r: Record<string, string>,
    sourceCategory: string,
    lineIdx: number,
  ): InquiryRow | null {
    const id = nz(r['問合せID']);
    if (!id || !/^TA-\d{9}$/.test(id)) {
      errors.push(`[${sourceCategory}]行${lineIdx + 2}: 問合せID 形式不正 "${id}"`);
      return null;
    }

    const formName = nz(r['フォーム名']);
    const formId = formName ? registerForm(formName, sourceCategory) : null;

    // member_id は DB に存在するもののみ採用 (FK 違反予防)
    const rawMemberId = nz(r['会員ID']);
    let memberId: string | null = null;
    if (rawMemberId && /^K-\d{9}$/.test(rawMemberId)) {
      if (memberIds.has(rawMemberId)) {
        memberId = rawMemberId;
      } else {
        memberIdMissingCount++;
      }
    }

    return {
      id,
      form_id: formId,
      member_id: memberId,
      name: cleanValue(nz(r['氏名'])),
      name_kana: cleanValue(nz(r['氏名かな'])),
      email: cleanValue(nz(r['メールアドレス'])),
      phone: cleanValue(nz(r['電話番号'])),
      postal_code: cleanValue(nz(r['郵便番号'])),
      address: cleanValue(nz(r['住所'])),
      ad_id: cleanValue(nz(r['広告ID'])),
      extra: extractExtra(r, COMMON_KEYS),
      registered_at: parseJpDateTime(nz(r['登録日時'])),
      source_category: sourceCategory,
    };
  }

  for (const [i, r] of kawara.entries()) {
    const row = convertRow(r, 'KAWARA版', i);
    if (row) inquiries.push(row);
  }
  for (const [i, r] of kimitsucp.entries()) {
    const row = convertRow(r, '機密保持・CP', i);
    if (row) inquiries.push(row);
  }

  // 問合せIDで重複排除 (同じTA-IDがあれば後勝ち)
  const dedupMap = new Map<string, InquiryRow>();
  for (const inq of inquiries) dedupMap.set(inq.id, inq);
  const dedupedInquiries = [...dedupMap.values()];

  logger.info(`問合せ合計: ${inquiries.length}件 (重複排除後: ${dedupedInquiries.length}件)`);
  logger.info(`フォーム種類: ${formMap.size}種`);
  if (memberIdMissingCount > 0) {
    logger.warn(
      `member_id が DB に存在しない問合せ ${memberIdMissingCount}件 → NULL で投入します`,
    );
  }
  if (errors.length > 0) {
    logger.warn(`変換エラー ${errors.length}件 (先頭10件):`);
    for (const e of errors.slice(0, 10)) logger.warn(`  ${e}`);
  }

  if (args.dryRun) {
    logger.info('--dry-run: DB 投入はスキップ');
    logger.info('--- フォームマスタ (先頭10件) ---');
    for (const [name, entry] of [...formMap.entries()].slice(0, 10)) {
      logger.info(`  id=${entry.id} category=${entry.category} name="${name}"`);
    }
    logger.info('--- 問合せ (先頭3件) ---');
    for (const inq of dedupedInquiries.slice(0, 3)) {
      logger.info(`  ${JSON.stringify({ id: inq.id, form_id: inq.form_id, name: inq.name })}`);
    }
    return;
  }

  const supabase = createMigrateClient();

  // ---- 3) forms 投入 (一旦クリアして再構築、id を CSV 順で割当) ----
  logger.info('forms 再構築...');
  await supabase.from('forms').delete().not('id', 'is', null); // 全削除

  const formsRows = [...formMap.entries()].map(([name, entry]) => ({
    id: entry.id,
    name,
    category: entry.category,
    description: null,
    is_active: true,
  }));
  const { error: fErr } = await supabase.from('forms').insert(formsRows);
  if (fErr) {
    logger.error(`forms 投入失敗: ${fErr.message}`);
    process.exit(1);
  }
  logger.info(`  forms 投入: ${formsRows.length}件`);

  // ---- 4) inquiries チャンク投入 ----
  const inquiryRecords = dedupedInquiries.map((inq) => ({
    id: inq.id,
    form_id: inq.form_id,
    member_id: inq.member_id,
    name: inq.name,
    name_kana: inq.name_kana,
    email: inq.email,
    phone: inq.phone,
    postal_code: inq.postal_code,
    address: inq.address,
    ad_id: inq.ad_id,
    extra: inq.extra,
    registered_at: inq.registered_at,
  }));

  const chunks = chunk(inquiryRecords, BATCH_SIZE);
  let inserted = 0;
  for (const [idx, batch] of chunks.entries()) {
    const { error } = await supabase
      .from('inquiries')
      .upsert(batch, { onConflict: 'id' });
    if (error) {
      logger.error(`バッチ${idx + 1} 投入失敗: ${error.message}`);
      logger.error(`サンプル: ${JSON.stringify(batch[0])}`);
      process.exit(1);
    }
    inserted += batch.length;
    if ((idx + 1) % 3 === 0 || idx === chunks.length - 1) {
      logger.info(`  進捗: ${inserted}/${inquiryRecords.length} (${Math.round((inserted / inquiryRecords.length) * 100)}%)`);
    }
  }

  const { count } = await supabase
    .from('inquiries')
    .select('id', { count: 'exact', head: true });
  logger.info(`✅ 投入完了: inquiries DB件数=${count} / forms=${formMap.size}`);
}

main().catch((e) => {
  logger.error('予期せぬエラー', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
