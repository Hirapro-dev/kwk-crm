/**
 * Phase 0: CSV 整合性検証スクリプト (DB 変更なし)
 *
 * 目的:
 *   5つの CSV を読み込んで、本取込前に必ず潰しておくべき整合性問題を一覧出力する。
 *
 * 検証項目:
 *   1. 案件名マッピング: 申込CSV「投資案件」 vs 案件マスタCSV「案件」
 *      - 案件マスタに無い案件名で申込が登録されている件数
 *   2. 担当者マッピング: 会員CSV「永久担当」/ 申込CSV「永久担当」「申込獲得者」
 *      - 既存 public.users.full_name と一致するか
 *   3. 直近6ヶ月レコード数の試算
 *      - members: registered_at
 *      - inquiries: 登録日時
 *      - applications: payment_date
 *   4. フォーム名一覧 (forms マスタ作成のため)
 *
 * 実行: npm run import:verify
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { readCsv } from '../migrate/lib/csv';
import { createMigrateClient } from '../migrate/lib/db';
import { logger } from '../migrate/lib/logger';
import { nz, parseJpDate, parseJpDateTime } from '../migrate/lib/normalizers';

const CSV_DIR = './csv';
const FILES = {
  anken: 'anken_csv.csv',
  kaiin: 'kaiin_csv.csv',
  kawara: 'kawara_scv.csv',
  kimitsucp: 'kimitsucp_csv.csv',
  moushikomi: 'moushikomi_csv.csv',
} as const;

/** 直近6ヶ月の境界日 (今日から180日前) */
const SIX_MONTHS_AGO = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);

function fmtCount(n: number, total: number): string {
  const pct = total === 0 ? 0 : Math.round((n / total) * 1000) / 10;
  return `${n.toLocaleString()} / ${total.toLocaleString()} (${pct}%)`;
}

function readCsvSafe(filename: string): Record<string, string>[] {
  const path = resolve(process.cwd(), CSV_DIR, filename);
  if (!existsSync(path)) {
    logger.error(`CSV が見つかりません: ${path}`);
    process.exit(1);
  }
  return readCsv(path, { trimValues: true }) as Record<string, string>[];
}

async function main(): Promise<void> {
  logger.info('===========================================');
  logger.info('Phase 0: CSV 整合性検証 (DB 変更なし)');
  logger.info(`基準日(6ヶ月前): ${SIX_MONTHS_AGO.toISOString().slice(0, 10)}`);
  logger.info('===========================================\n');

  // -------------------------------------------------------------
  // 1. CSV 読み込み + 件数
  // -------------------------------------------------------------
  logger.info('[1] CSV 読み込み');
  const anken = readCsvSafe(FILES.anken);
  const kaiin = readCsvSafe(FILES.kaiin);
  const kawara = readCsvSafe(FILES.kawara);
  const kimitsucp = readCsvSafe(FILES.kimitsucp);
  const moushikomi = readCsvSafe(FILES.moushikomi);
  logger.info(`  案件マスタ: ${anken.length}件`);
  logger.info(`  会員: ${kaiin.length}件`);
  logger.info(`  KAWARA問合せ: ${kawara.length}件`);
  logger.info(`  機密保持CP問合せ: ${kimitsucp.length}件`);
  logger.info(`  申込: ${moushikomi.length}件`);
  logger.info('');

  // -------------------------------------------------------------
  // 2. 直近6ヶ月レコード数試算
  // -------------------------------------------------------------
  logger.info('[2] 直近6ヶ月レコード数試算');

  // 会員: 登録日 列で絞る
  const kaiinRecent = kaiin.filter((r) => {
    const d = parseJpDate(nz(r['登録日']));
    if (!d) return false;
    return new Date(d) >= SIX_MONTHS_AGO;
  });
  logger.info(`  会員 (登録日): ${fmtCount(kaiinRecent.length, kaiin.length)}`);

  // KAWARA問合せ: 登録日時 列
  const kawaraRecent = kawara.filter((r) => {
    const d = parseJpDateTime(nz(r['登録日時']));
    if (!d) return false;
    return new Date(d) >= SIX_MONTHS_AGO;
  });
  logger.info(`  KAWARA問合せ (登録日時): ${fmtCount(kawaraRecent.length, kawara.length)}`);

  // 機密保持CP: 登録日時
  const kimitsucpRecent = kimitsucp.filter((r) => {
    const d = parseJpDateTime(nz(r['登録日時']));
    if (!d) return false;
    return new Date(d) >= SIX_MONTHS_AGO;
  });
  logger.info(
    `  機密保持CP問合せ (登録日時): ${fmtCount(kimitsucpRecent.length, kimitsucp.length)}`,
  );

  // 申込: payment_date(入金日) で絞る
  const moushikomiRecent = moushikomi.filter((r) => {
    const d = parseJpDate(nz(r['入金日']));
    if (!d) return false;
    return new Date(d) >= SIX_MONTHS_AGO;
  });
  logger.info(`  申込 (入金日): ${fmtCount(moushikomiRecent.length, moushikomi.length)}`);
  logger.info('');

  // -------------------------------------------------------------
  // 3. 案件名マッピング検証
  // -------------------------------------------------------------
  logger.info('[3] 案件名マッピング検証');

  // 案件マスタの「案件」列で {案件名: 案件ID} 辞書を作成
  const projectMap = new Map<string, string>();
  for (const r of anken) {
    const name = nz(r['案件']);
    const id = nz(r['案件ID']);
    if (name && id) projectMap.set(name, id);
  }
  logger.info(`  案件マスタ辞書: ${projectMap.size}件`);

  // 申込CSV(直近6ヶ月)の「投資案件」列の値をユニーク化
  const usedProjects = new Map<string, number>();
  for (const r of moushikomiRecent) {
    const p = nz(r['投資案件']);
    if (!p) continue;
    usedProjects.set(p, (usedProjects.get(p) ?? 0) + 1);
  }

  // 不一致リスト
  const unmatchedProjects: { name: string; count: number }[] = [];
  for (const [name, count] of usedProjects.entries()) {
    if (!projectMap.has(name)) {
      unmatchedProjects.push({ name, count });
    }
  }

  logger.info(`  申込CSV(直近6ヶ月)で使用された案件名: ${usedProjects.size}種`);
  if (unmatchedProjects.length === 0) {
    logger.info('  ✅ すべて案件マスタにマッチします');
  } else {
    logger.warn(`  ⚠️ 不一致 ${unmatchedProjects.length}種:`);
    for (const u of unmatchedProjects
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)) {
      logger.warn(`    - "${u.name}" (${u.count}件の申込)`);
    }
    if (unmatchedProjects.length > 20) {
      logger.warn(`    ... 他 ${unmatchedProjects.length - 20}種`);
    }
  }
  logger.info('');

  // -------------------------------------------------------------
  // 4. 担当者(永久担当/申込獲得者) マッピング検証
  // -------------------------------------------------------------
  logger.info('[4] 担当者マッピング検証');

  // 既存 public.users から full_name の集合取得
  const supabase = createMigrateClient();
  const { data: users, error: uErr } = await supabase
    .from('users')
    .select('full_name, last_name')
    .is('deleted_at', null);
  if (uErr) {
    logger.error(`users 取得失敗: ${uErr.message}`);
    process.exit(1);
  }
  const userFullNames = new Set<string>();
  const userLastNames = new Set<string>();
  for (const u of users ?? []) {
    if (u.full_name) userFullNames.add(u.full_name);
    if (u.last_name) userLastNames.add(u.last_name);
  }
  logger.info(`  既存 users: ${userFullNames.size}件 (full_name)`);

  // 永久担当 / 申込獲得者 の値を集計 (直近6ヶ月の申込から)
  const ownerNames = new Map<string, number>();
  const acquirerNames = new Map<string, number>();
  for (const r of moushikomiRecent) {
    const o = nz(r['永久担当']);
    const a = nz(r['申込獲得者']);
    if (o && o !== 'Free') ownerNames.set(o, (ownerNames.get(o) ?? 0) + 1);
    if (a) acquirerNames.set(a, (acquirerNames.get(a) ?? 0) + 1);
  }

  // 会員CSV(全件)の永久担当も集計
  const memberOwnerNames = new Map<string, number>();
  for (const r of kaiinRecent) {
    const o = nz(r['永久担当']);
    if (o && o !== 'Free') memberOwnerNames.set(o, (memberOwnerNames.get(o) ?? 0) + 1);
  }

  function checkNameMatch(
    label: string,
    names: Map<string, number>,
  ): void {
    const unmatched: { name: string; count: number }[] = [];
    for (const [name, count] of names.entries()) {
      // 完全一致 or 姓のみ一致
      const isMatch =
        userFullNames.has(name) ||
        userLastNames.has(name) ||
        [...userLastNames].some((ln) => name.startsWith(ln));
      if (!isMatch) unmatched.push({ name, count });
    }
    logger.info(`  ${label}: ${names.size}種, マッチ ${names.size - unmatched.length}種`);
    if (unmatched.length > 0) {
      logger.warn(`    ⚠️ 不一致 ${unmatched.length}種:`);
      for (const u of unmatched
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)) {
        logger.warn(`      - "${u.name}" (${u.count}件)`);
      }
      if (unmatched.length > 10) {
        logger.warn(`      ... 他 ${unmatched.length - 10}種`);
      }
    }
  }

  checkNameMatch('申込CSV「永久担当」(直近6ヶ月)', ownerNames);
  checkNameMatch('申込CSV「申込獲得者」(直近6ヶ月)', acquirerNames);
  checkNameMatch('会員CSV「永久担当」(直近6ヶ月)', memberOwnerNames);
  logger.info('');

  // -------------------------------------------------------------
  // 5. フォーム名一覧 (forms マスタ作成用)
  // -------------------------------------------------------------
  logger.info('[5] フォーム名一覧');

  const formNames = new Map<string, number>();
  for (const r of kawaraRecent) {
    const f = nz(r['フォーム名']);
    if (!f) continue;
    formNames.set(f, (formNames.get(f) ?? 0) + 1);
  }
  for (const r of kimitsucpRecent) {
    const f = nz(r['フォーム名']);
    if (!f) continue;
    formNames.set(f, (formNames.get(f) ?? 0) + 1);
  }
  logger.info(`  ユニークフォーム名: ${formNames.size}種`);
  for (const [name, count] of [...formNames.entries()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 30)) {
    logger.info(`    - "${name}" (${count}件)`);
  }
  if (formNames.size > 30) {
    logger.info(`    ... 他 ${formNames.size - 30}種`);
  }
  logger.info('');

  // -------------------------------------------------------------
  // 6. 申込 FK 解決可否 (member_id / inquiry_id)
  // -------------------------------------------------------------
  logger.info('[6] 申込 FK 解決可否 (直近6ヶ月)');

  const memberIds = new Set(
    kaiinRecent
      .map((r) => nz(r['会員ID']))
      .filter((v): v is string => !!v),
  );
  const inquiryIds = new Set([
    ...kawaraRecent.map((r) => nz(r['問合せID'])),
    ...kimitsucpRecent.map((r) => nz(r['問合せID'])),
  ].filter((v): v is string => !!v));

  let mFkOk = 0;
  let mFkNg = 0;
  let iFkOk = 0;
  let iFkNg = 0;
  let iFkBlank = 0;
  for (const r of moushikomiRecent) {
    const mid = nz(r['会員ID']);
    const iid = nz(r['問合せ管理ID']);
    if (mid && memberIds.has(mid)) mFkOk++;
    else mFkNg++;
    if (!iid) iFkBlank++;
    else if (inquiryIds.has(iid)) iFkOk++;
    else iFkNg++;
  }
  logger.info(`  member_id 解決: OK=${mFkOk} / NG=${mFkNg}`);
  logger.info(`  inquiry_id 解決: OK=${iFkOk} / NG=${iFkNg} / 空=${iFkBlank}`);
  logger.info('');

  // -------------------------------------------------------------
  // 結論
  // -------------------------------------------------------------
  logger.info('===========================================');
  logger.info('結論');
  logger.info('===========================================');
  if (unmatchedProjects.length === 0 && mFkNg === 0 && iFkNg === 0) {
    logger.info('✅ 整合性問題なし。Phase 1 (DB migration) に進めます。');
  } else {
    logger.warn('⚠️ 以下の問題があります:');
    if (unmatchedProjects.length > 0) {
      logger.warn(`  - 案件名マッピング不一致 ${unmatchedProjects.length}種`);
      logger.warn(`    → 案件マスタCSVに追加するか、申込CSVの表記を修正してください`);
    }
    if (mFkNg > 0) {
      logger.warn(`  - 申込 member_id 解決失敗 ${mFkNg}件`);
      logger.warn(`    → 該当申込は project_id/member_id が NULL になります`);
    }
    if (iFkNg > 0) {
      logger.warn(`  - 申込 inquiry_id 解決失敗 ${iFkNg}件`);
      logger.warn(`    → 該当申込は inquiry_id が NULL になります`);
    }
  }
  logger.info('');
  logger.info('※ DB は一切変更していません。');
}

main().catch((e) => {
  logger.error('予期せぬエラー', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
