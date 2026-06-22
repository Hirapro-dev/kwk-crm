/**
 * applications.acquirer_id を新規 sales 7名にマッピングするテスト用スクリプト。
 *
 * 目的:
 *   - サマリ画面 (/summary) で各 sales ユーザーに入金実績が乗るように、
 *     既存 applications のうち acquirer_id が NULL のものをサンプル更新する。
 *
 * 仕様 (過去会話で確定):
 *   - 対象: applications.acquirer_id IS NULL AND deleted_at IS NULL
 *           (Q4-B: 既に acquirer_id が入っているレコードはスキップ)
 *   - サンプル数: 各 sales 最大 limitPerUser 件 (デフォルト 15、Q3-B: 約100件)
 *   - マッチング: acquirer_name_raw の文字列に新7名の姓 or フルネームが含まれているレコードを優先
 *   - 不足分: マッチが取れない sales には残り NULL レコードからランダム割当 (--fill-empty)
 *   - 順序: payment_date DESC (直近の実績を優先)
 *
 * 実行:
 *   npm run seed:acquirers              # 名前マッチングのみ + dry-run なし
 *   npm run seed:acquirers -- --dry-run # 更新せずプレビューだけ
 *   npm run seed:acquirers -- --fill-empty # 不足分はランダム割り当て
 */

import { parseArgs } from '../migrate/lib/args';
import { createMigrateClient } from '../migrate/lib/db';
import { logger } from '../migrate/lib/logger';

/** 各 sales に紐付ける最大件数 */
const LIMIT_PER_USER = 15;

/** 対象 sales のフルネーム (DB の users.full_name と一致させる) */
const SALES_NAMES = [
  '植田 雄輝',
  '守田 和之',
  '東山 優也',
  '谷川 龍',
  '紺野 元汰',
  '小熊 壮一郎',
  '岩井 智哉',
];

/** 姓だけのリスト (name_raw に「植田」だけ書かれてるケース対応) */
const SALES_LAST_NAMES = SALES_NAMES.map((n) => n.split(/[\s ]+/)[0] ?? n);

interface CliArgs {
  dryRun: boolean;
  fillEmpty: boolean;
}

function parseCliArgs(): CliArgs {
  const base = parseArgs();
  const fillEmpty = process.argv.includes('--fill-empty');
  return { dryRun: base.dryRun, fillEmpty };
}

async function main(): Promise<void> {
  const args = parseCliArgs();
  const supabase = createMigrateClient();

  logger.info('acquirers マッピング開始', args);

  // 1) 新7名の sales ユーザー一覧取得
  const { data: users, error: uErr } = await supabase
    .from('users')
    .select('id, full_name, last_name, email')
    .in('full_name', SALES_NAMES)
    .eq('role', 'sales')
    .is('deleted_at', null);
  if (uErr) {
    logger.error(`sales ユーザー取得失敗: ${uErr.message}`);
    process.exit(1);
  }
  if (!users || users.length === 0) {
    logger.error('sales ユーザーが見つかりません。先に npm run seed:sales を実行してください');
    process.exit(1);
  }
  logger.info(`対象 sales ユーザー: ${users.length}名`);
  for (const u of users) logger.info(`  - ${u.full_name} <${u.email}> (${u.id})`);

  // 2) 各 sales ごとに name_raw マッチング更新
  const stats: Record<string, number> = {};
  let totalUpdated = 0;

  for (const user of users) {
    const lastName = user.last_name ?? user.full_name?.split(/[\s ]+/)[0];
    if (!lastName) {
      logger.warn(`姓が取得できません: ${user.full_name}`);
      continue;
    }

    // acquirer_name_raw LIKE %lastName% で候補取得
    const { data: candidates, error: cErr } = await supabase
      .from('applications')
      .select('id, acquirer_name_raw, payment_amount, payment_date')
      .is('acquirer_id', null) // Q4-B: NULL のみ更新
      .is('deleted_at', null)
      .ilike('acquirer_name_raw', `%${lastName}%`)
      .order('payment_date', { ascending: false, nullsFirst: false })
      .limit(LIMIT_PER_USER);
    if (cErr) {
      logger.error(`候補取得失敗 (${user.full_name}): ${cErr.message}`);
      continue;
    }

    const targetIds = (candidates ?? []).map((c) => c.id);
    if (targetIds.length === 0) {
      logger.info(`  [${user.full_name}] マッチ候補なし`);
      stats[user.full_name ?? user.id] = 0;
      continue;
    }

    logger.info(`  [${user.full_name}] マッチ候補 ${targetIds.length}件 を更新`);
    if (args.dryRun) {
      for (const c of (candidates ?? []).slice(0, 3)) {
        logger.info(
          `    sample: id=${c.id} name_raw="${c.acquirer_name_raw}" amount=${c.payment_amount}`,
        );
      }
      stats[user.full_name ?? user.id] = targetIds.length;
      totalUpdated += targetIds.length;
      continue;
    }

    const { error: upErr, count } = await supabase
      .from('applications')
      .update({ acquirer_id: user.id }, { count: 'exact' })
      .in('id', targetIds);
    if (upErr) {
      logger.error(`更新失敗 (${user.full_name}): ${upErr.message}`);
      continue;
    }
    stats[user.full_name ?? user.id] = count ?? 0;
    totalUpdated += count ?? 0;
  }

  // 3) --fill-empty: マッチ不足分は NULL applications からランダム割当
  if (args.fillEmpty) {
    logger.info('fillEmpty: 不足ユーザーにランダム割り当て');
    for (const user of users) {
      const already = stats[user.full_name ?? user.id] ?? 0;
      if (already >= LIMIT_PER_USER) continue;
      const need = LIMIT_PER_USER - already;

      const { data: extras, error: eErr } = await supabase
        .from('applications')
        .select('id, payment_amount')
        .is('acquirer_id', null)
        .is('deleted_at', null)
        .not('payment_amount', 'is', null)
        .gt('payment_amount', 0)
        .order('payment_date', { ascending: false, nullsFirst: false })
        .limit(need);
      if (eErr || !extras || extras.length === 0) continue;

      const ids = extras.map((e) => e.id);
      logger.info(`  [${user.full_name}] 追加 ${ids.length}件 (ランダム割当)`);
      if (args.dryRun) {
        stats[user.full_name ?? user.id] = already + ids.length;
        totalUpdated += ids.length;
        continue;
      }
      const { error: upErr, count } = await supabase
        .from('applications')
        .update({ acquirer_id: user.id }, { count: 'exact' })
        .in('id', ids);
      if (upErr) {
        logger.error(`追加更新失敗 (${user.full_name}): ${upErr.message}`);
        continue;
      }
      stats[user.full_name ?? user.id] = already + (count ?? 0);
      totalUpdated += count ?? 0;
    }
  }

  // 4) サマリ
  logger.info('=========================================');
  logger.info(`${args.dryRun ? '[DRY-RUN] ' : ''}更新結果サマリ:`);
  for (const [name, n] of Object.entries(stats)) {
    logger.info(`  ${name}: ${n}件`);
  }
  logger.info(`合計: ${totalUpdated}件`);
  logger.info('=========================================');
  if (args.dryRun) {
    logger.info('※ dry-run のため DB は更新していません。実行するには --dry-run を外してください');
  }
}

main().catch((e) => {
  logger.error('予期せぬエラー', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
