/**
 * 全ユーザーに同一パスワードを設定するスクリプト。
 *
 * - public.users の有効ユーザー(deleted_at IS NULL, email あり)を全件取得
 * - Supabase Auth にアカウントが無いユーザーは createUser で作成 → パスワード設定
 * - 既にアカウントがあるユーザーは updateUserById でパスワードのみ更新
 *
 * 使い方:
 *   npx tsx scripts/migrate/set_all_passwords.ts --password "設定するパスワード" --dry-run
 *   npx tsx scripts/migrate/set_all_passwords.ts --password "設定するパスワード"
 */

import { createMigrateClient } from './lib/db';
import { logger } from './lib/logger';

const SCRIPT_NAME = 'set_all_passwords';

// コマンドライン引数のパース
function parseArgs() {
  const args = process.argv.slice(2);
  const result: { password?: string; dryRun: boolean } = { dryRun: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--password' && args[i + 1]) {
      result.password = args[++i];
    } else if (args[i] === '--dry-run') {
      result.dryRun = true;
    }
  }
  return result;
}

async function main() {
  const args = parseArgs();

  if (!args.password) {
    logger.error('--password オプションでパスワードを指定してください');
    logger.error('例: npx tsx scripts/migrate/set_all_passwords.ts --password "パスワード"');
    process.exit(1);
  }

  if (args.password.length < 6) {
    logger.error('パスワードは6文字以上にしてください');
    process.exit(1);
  }

  logger.info(`開始: ${SCRIPT_NAME}`, { dryRun: args.dryRun });

  const supabase = createMigrateClient();

  // public.users から有効ユーザー全件取得
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

  let created = 0;
  let updated = 0;
  let failed = 0;

  for (const user of users) {
    if (!user.email) continue;

    if (args.dryRun) {
      logger.info(`[dry-run] ${user.full_name ?? user.email} (${user.id})`);
      continue;
    }

    // まず既存の auth アカウントを更新してみる
    const { error: updateErr } = await supabase.auth.admin.updateUserById(user.id, {
      password: args.password,
    });

    if (!updateErr) {
      logger.info(`更新: ${user.full_name ?? user.email}`);
      updated++;
      continue;
    }

    // "User not found" → auth アカウントがないので新規作成
    if (updateErr.message.includes('User not found') || updateErr.status === 404) {
      const { error: createErr } = await supabase.auth.admin.createUser({
        id: user.id, // public.users の UUID と一致させる(必須)
        email: user.email,
        password: args.password,
        email_confirm: true, // メール確認をスキップしてすぐにログイン可能に
        user_metadata: {
          full_name: user.full_name,
          first_name: user.first_name,
          last_name: user.last_name,
        },
      });

      if (createErr) {
        // メアド重複などで作成失敗 → IDで再試行(既存authユーザーとIDが食い違う場合)
        logger.warn(`作成失敗: ${user.full_name ?? user.email} - ${createErr.message}`);
        failed++;
      } else {
        logger.info(`新規作成: ${user.full_name ?? user.email}`);
        created++;
      }
    } else {
      logger.warn(`更新失敗: ${user.full_name ?? user.email} - ${updateErr.message}`);
      failed++;
    }
  }

  logger.info(`完了: 新規作成=${created}, パスワード更新=${updated}, 失敗=${failed}`);

  if (failed > 0) {
    logger.warn('失敗したユーザーは上のログを確認してください');
  }
}

main().catch((e) => {
  logger.error('予期せぬエラー', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
