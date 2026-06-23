/**
 * auth.users の UUID を public.users の UUID に揃えるスクリプト。
 *
 * 背景:
 *   set_all_passwords.ts で id 未指定で createUser したため、
 *   94人の auth.users UUID が public.users と不一致になった。
 *   ログイン時に getCurrentUser() が失敗しグローバルエラーになる。
 *
 * 処理:
 *   1. public.users から全員取得
 *   2. email で auth.users を検索
 *   3. UUID が一致しない場合 → 旧 auth ユーザー削除 → 正しい UUID で再作成
 *   4. UUID が一致している場合 → パスワードのみ更新(スキップ可)
 *
 * 使い方:
 *   npx tsx scripts/migrate/fix_auth_uuids.ts --password "19870323" --dry-run
 *   npx tsx scripts/migrate/fix_auth_uuids.ts --password "19870323"
 */

import { createMigrateClient } from './lib/db';
import { logger } from './lib/logger';

function parseArgs() {
  const args = process.argv.slice(2);
  const result: { password?: string; dryRun: boolean } = { dryRun: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--password' && args[i + 1]) result.password = args[++i];
    else if (args[i] === '--dry-run') result.dryRun = true;
  }
  return result;
}

async function main() {
  const args = parseArgs();
  if (!args.password) {
    logger.error('--password オプションでパスワードを指定してください');
    process.exit(1);
  }

  logger.info('fix_auth_uuids 開始', { dryRun: args.dryRun });

  const supabase = createMigrateClient();

  // 1. public.users 全員取得
  const { data: users, error: fetchErr } = await supabase
    .from('users')
    .select('id, email, full_name, first_name, last_name')
    .is('deleted_at', null)
    .not('email', 'is', null)
    .order('full_name');

  if (fetchErr || !users) {
    logger.error('ユーザー取得失敗', { error: fetchErr?.message });
    process.exit(1);
  }
  logger.info(`対象ユーザー数: ${users.length}`);

  // 2. auth.users 全員取得(listUsers はページネーション対応)
  const authUserMap = new Map<string, string>(); // email → auth UUID
  let page = 1;
  while (true) {
    const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (listErr || !list) break;
    for (const u of list.users) {
      if (u.email) authUserMap.set(u.email.toLowerCase(), u.id);
    }
    if (list.users.length < 1000) break;
    page++;
  }
  logger.info(`auth.users 取得: ${authUserMap.size} 件`);

  let fixed = 0;
  let alreadyOk = 0;
  let noAuth = 0;
  let failed = 0;

  for (const user of users) {
    if (!user.email) continue;
    const authId = authUserMap.get(user.email.toLowerCase());

    if (!authId) {
      // auth アカウントがない → 新規作成
      if (args.dryRun) {
        logger.info(`[dry-run] 新規作成: ${user.full_name ?? user.email} (id=${user.id})`);
        noAuth++;
        continue;
      }
      const { error } = await supabase.auth.admin.createUser({
        id: user.id,
        email: user.email,
        password: args.password,
        email_confirm: true,
        user_metadata: { full_name: user.full_name, first_name: user.first_name, last_name: user.last_name },
      });
      if (error) {
        logger.warn(`新規作成失敗: ${user.full_name ?? user.email} - ${error.message}`);
        failed++;
      } else {
        logger.info(`新規作成: ${user.full_name ?? user.email}`);
        noAuth++;
      }
      continue;
    }

    if (authId === user.id) {
      // UUID一致 → パスワードのみ更新
      if (!args.dryRun) {
        await supabase.auth.admin.updateUserById(user.id, { password: args.password });
      }
      alreadyOk++;
      continue;
    }

    // UUID不一致 → 旧削除 → 正しいIDで再作成
    logger.info(`UUID不一致: ${user.full_name ?? user.email} auth=${authId} → 修正 → ${user.id}`);

    if (args.dryRun) {
      fixed++;
      continue;
    }

    const { error: delErr } = await supabase.auth.admin.deleteUser(authId);
    if (delErr) {
      logger.warn(`削除失敗: ${user.full_name ?? user.email} - ${delErr.message}`);
      failed++;
      continue;
    }

    const { error: createErr } = await supabase.auth.admin.createUser({
      id: user.id,
      email: user.email,
      password: args.password,
      email_confirm: true,
      user_metadata: { full_name: user.full_name, first_name: user.first_name, last_name: user.last_name },
    });

    if (createErr) {
      logger.warn(`再作成失敗: ${user.full_name ?? user.email} - ${createErr.message}`);
      failed++;
    } else {
      fixed++;
    }
  }

  logger.info(`完了: UUID修正=${fixed}, 既存OK=${alreadyOk}, 新規作成=${noAuth}, 失敗=${failed}`);
}

main().catch((e) => {
  logger.error('予期せぬエラー', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
