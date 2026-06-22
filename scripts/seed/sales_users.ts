/**
 * sales ロールの社内スタッフ7名を Supabase Auth + public.users に登録するスクリプト。
 *
 * 仕様書 §7.1 / §7.3
 *
 * 流れ:
 *   1. supabase.auth.admin.createUser() で auth.users にメール/パスワード/メタデータを登録
 *   2. handle_new_auth_user() トリガーで public.users に viewer 行が作られる前提だが、
 *      ここでは確実に sales ロール + 姓名で UPDATE する
 *   3. 同名メアドが既存の場合はエラー終了 (仕様: 上書きしない)
 *
 * 実行: npm run seed:sales
 *
 * 必要な環境変数 (.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY  ← admin API 用、絶対に公開しない
 */

import { createMigrateClient } from '../migrate/lib/db';
import { logger } from '../migrate/lib/logger';

interface SalesStaff {
  /** 表示名(姓 名、半角スペース区切り) */
  full_name: string;
  /** ダミーメアド */
  email: string;
  /** 初期パスワード (本人が初回ログイン後変更想定) */
  password: string;
}

// テスト用: Gmail + エイリアスで全員 kowaki1111@gmail.com に届く
const STAFF: SalesStaff[] = [
  { full_name: '植田 雄輝', email: 'kowaki1111+ueda@gmail.com', password: 'testtest' },
  { full_name: '守田 和之', email: 'kowaki1111+morita@gmail.com', password: 'testtest' },
  { full_name: '東山 優也', email: 'kowaki1111+higashiyama@gmail.com', password: 'testtest' },
  { full_name: '谷川 龍', email: 'kowaki1111+tanikawa@gmail.com', password: 'testtest' },
  { full_name: '紺野 元汰', email: 'kowaki1111+konno@gmail.com', password: 'testtest' },
  { full_name: '小熊 壮一郎', email: 'kowaki1111+oguma@gmail.com', password: 'testtest' },
  { full_name: '岩井 智哉', email: 'kowaki1111+iwai@gmail.com', password: 'testtest' },
];

/**
 * 姓 名 (半角スペース区切り) を分割。スペースが無い場合は全体を last_name に。
 */
function splitName(fullName: string): { last_name: string; first_name: string | null } {
  const parts = fullName.split(/[\s ]+/).filter(Boolean);
  if (parts.length >= 2) {
    return { last_name: parts[0]!, first_name: parts.slice(1).join(' ') };
  }
  return { last_name: parts[0] ?? fullName, first_name: null };
}

async function main(): Promise<void> {
  const supabase = createMigrateClient();

  logger.info(`sales ユーザー登録開始: ${STAFF.length}名`);

  // 1) 事前チェック: メアド or 氏名で既存ユーザーがいたら全件 abort
  const existingEmails: string[] = [];
  for (const s of STAFF) {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, full_name')
      .or(`email.eq.${s.email},full_name.eq.${s.full_name}`)
      .is('deleted_at', null);
    if (error) {
      logger.error(`既存チェック失敗: ${error.message}`);
      process.exit(1);
    }
    if (data && data.length > 0) {
      existingEmails.push(`${s.email}(${s.full_name}) -> 既存: ${data.map((d) => d.email).join(', ')}`);
    }
  }
  if (existingEmails.length > 0) {
    logger.error('既存ユーザーと重複しています。中断します。');
    for (const e of existingEmails) logger.error('  ' + e);
    process.exit(1);
  }

  // 2) 登録ループ
  const succeeded: { email: string; auth_id: string }[] = [];
  const failed: { email: string; error: string }[] = [];

  for (const s of STAFF) {
    const { last_name, first_name } = splitName(s.full_name);

    // 2a) auth.users 作成
    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email: s.email,
      password: s.password,
      email_confirm: true, // 確認メール送信せず即有効化
      user_metadata: { full_name: s.full_name },
    });
    if (authErr || !authData?.user) {
      failed.push({ email: s.email, error: authErr?.message ?? 'auth user 作成失敗' });
      logger.error(`auth 作成失敗: ${s.email} - ${authErr?.message}`);
      continue;
    }

    const authUserId = authData.user.id;

    // 2b) public.users を upsert(handle_new_auth_user トリガーが viewer で作るので UPDATE)
    //     念のため upsert で確実に登録
    const { error: upsertErr } = await supabase
      .from('users')
      .upsert(
        {
          id: authUserId,
          email: s.email,
          last_name,
          first_name,
          full_name: s.full_name,
          role: 'sales',
          is_active: true,
          legacy_sf_id: null,
        },
        { onConflict: 'id' },
      );

    if (upsertErr) {
      failed.push({ email: s.email, error: `public.users upsert失敗: ${upsertErr.message}` });
      logger.error(`public.users upsert失敗: ${s.email} - ${upsertErr.message}`);
      // auth.users に残してしまうとゴミなので削除
      await supabase.auth.admin.deleteUser(authUserId);
      continue;
    }

    succeeded.push({ email: s.email, auth_id: authUserId });
    logger.info(`登録完了: ${s.full_name} <${s.email}> (id=${authUserId})`);
  }

  logger.info(`登録結果: 成功=${succeeded.length} / 失敗=${failed.length}`);
  if (failed.length > 0) {
    for (const f of failed) logger.error(`  失敗: ${f.email} - ${f.error}`);
    process.exit(1);
  }
}

main().catch((e) => {
  logger.error('予期せぬエラー', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
