/**
 * 移行スクリプト共通: users テーブルから OwnerResolver 構築用データを取得
 * 仕様書 §6.3: 永久担当の名前 → users.id 解決のため、移行スクリプト先頭で全 users をロード。
 */

import type { MigrateClient } from './db';
import { OwnerResolver, type OwnerUser } from './owner_resolver';

export async function loadUsersForOwnerResolver(
  supabase: MigrateClient,
): Promise<{ users: OwnerUser[]; resolver: OwnerResolver }> {
  const users: OwnerUser[] = [];
  const PAGE = 1000;
  let from = 0;
  // 念のためページネーション(102件程度想定だが将来増加に備える)
  while (true) {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, first_name, last_name, full_name')
      .is('deleted_at', null)
      .range(from, from + PAGE - 1);
    if (error) {
      throw new Error(`users ロード失敗: ${error.message}`);
    }
    if (!data || data.length === 0) break;
    users.push(...(data as OwnerUser[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return { users, resolver: new OwnerResolver(users) };
}
