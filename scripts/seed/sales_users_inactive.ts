/**
 * sales ロールの追加スタッフ4名を Supabase Auth + public.users に登録するスクリプト。
 *
 * 過去会話で確定:
 *   - 鈴木 千尋, 牧野 克哉, 江口 裕人, 黒田 拓巳 を追加
 *   - is_active = false で登録 (過去データには登場するが、現在は無効)
 *   - エイリアス方式 kowaki1111+xxx@gmail.com
 *
 * 既存の seed:sales (sales_users.ts) は触らず、追加のみ。
 *
 * 実行: npm run seed:sales:inactive
 */

import { createMigrateClient } from '../migrate/lib/db';
import { logger } from '../migrate/lib/logger';

interface SalesStaff {
  full_name: string;
  email: string;
  password: string;
}

// is_active=false で登録するスタッフ
const STAFF: SalesStaff[] = [
  { full_name: '鈴木 千尋', email: 'kowaki1111+suzuki@gmail.com', password: 'testtest' },
  { full_name: '牧野 克哉', email: 'kowaki1111+makino@gmail.com', password: 'testtest' },
  { full_name: '江口 裕人', email: 'kowaki1111+eguchi@gmail.com', password: 'testtest' },
  { full_name: '黒田 拓巳', email: 'kowaki1111+kuroda@gmail.com', password: 'testtest' },
];

function splitName(fullName: string): { last_name: string; first_name: string | null } {
  const parts = fullName.split(/[\s ]+/).filter(Boolean);
  if (parts.length >= 2) {
    return { last_name: parts[0]!, first_name: parts.slice(1).join(' ') };
  }
  return { last_name: parts[0] ?? fullName, first_name: null };
}

async function main(): Promise<void> {
  const supabase = createMigrateClient();
  logger.info(`sales ユーザー登録(is_active=false): ${STAFF.length}名`);

  // 既存チェック
  const existingProblems: string[] = [];
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
      existingProblems.push(`${s.email}(${s.full_name}) -> 既存: ${data.map((d) => d.email).join(', ')}`);
    }
  }
  if (existingProblems.length > 0) {
    logger.error('既存ユーザーと重複しています。中断します。');
    for (const e of existingProblems) logger.error('  ' + e);
    process.exit(1);
  }

  const succeeded: { email: string; auth_id: string }[] = [];
  const failed: { email: string; error: string }[] = [];

  for (const s of STAFF) {
    const { last_name, first_name } = splitName(s.full_name);

    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email: s.email,
      password: s.password,
      email_confirm: true,
      user_metadata: { full_name: s.full_name },
    });
    if (authErr || !authData?.user) {
      failed.push({ email: s.email, error: authErr?.message ?? 'auth user 作成失敗' });
      logger.error(`auth 作成失敗: ${s.email} - ${authErr?.message}`);
      continue;
    }

    const authUserId = authData.user.id;

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
          is_active: false, // ★ 無効状態で登録
          legacy_sf_id: null,
        },
        { onConflict: 'id' },
      );

    if (upsertErr) {
      failed.push({ email: s.email, error: `public.users upsert失敗: ${upsertErr.message}` });
      logger.error(`public.users upsert失敗: ${s.email} - ${upsertErr.message}`);
      await supabase.auth.admin.deleteUser(authUserId);
      continue;
    }

    succeeded.push({ email: s.email, auth_id: authUserId });
    logger.info(`登録完了(無効): ${s.full_name} <${s.email}> (id=${authUserId})`);
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
