/**
 * プロテクト取込(再実行用) — ローカルCSV版
 * lib/domain/protect_import_actions.ts と同じロジックを CLI で再現する。
 *
 * CSV: Id, Member_ID__c, Name, OwnerId, protect__c
 *   protect__c:
 *     - 'free' / 'ex sales' / 空 → スキップ(プロテクトなし・既存は据え置き)
 *     - '会社プロテクト'          → 固定プロテクト(2099年)
 *     - ユーザー名               → OwnerId(SF) を legacy_sf_id でユーザー逆引き
 *   固定判定(isFixed): 会社プロテクト / 保持ユーザーが無効 / 固定担当名 / 情報取得ポイント該当
 *   期限: 固定 → 2099-01-01, それ以外 → アクティブなフロールール(days_at_time)で計算
 *
 * 使い方:
 *   npx tsx scripts/migrate/11_protect_import.ts --dry-run --file <csv>
 *   npx tsx scripts/migrate/11_protect_import.ts --file <csv>
 */

import { type FlowRule, calcExpiresAt } from '../../lib/domain/flow_rules_types';
import { parseArgs } from './lib/args';
import { readCsv } from './lib/csv';
import { createMigrateClient } from './lib/db';

const DEFAULT_CSV = '/Users/takaya/Desktop/csv/顧客情報プロテクト.csv';
const FIXED_PROTECT_EXPIRES = '2099-01-01T15:00:00.000Z';
const FIXED_PROTECT_VALUES = new Set(['会社プロテクト']);
const FIXED_PROTECT_USER_NAMES = new Set(['守田 和之', '守田 和幸', '植田 雄輝']);
const FIXED_ACQUIRE_KEYWORDS = ['既存顧客の紹介', 'リスト外'];

interface UserRow {
  id: string;
  full_name: string | null;
  is_active: boolean;
}

async function main() {
  const args = parseArgs();
  const csvPath = args.file ?? DEFAULT_CSV;
  const supabase = createMigrateClient();

  console.log(`\n[protect import] ${args.dryRun ? '★ DRY-RUN ★' : '本番実行'}`);
  console.log(`CSV: ${csvPath}\n`);

  // users: legacy_sf_id → user
  const { data: users } = await supabase
    .from('users')
    .select('id, full_name, legacy_sf_id, is_active')
    .is('deleted_at', null);
  const userBySfId = new Map<string, UserRow>();
  for (const u of (users ?? []) as (UserRow & { legacy_sf_id: string | null })[]) {
    if (u.legacy_sf_id) userBySfId.set(u.legacy_sf_id, u);
  }
  console.log(`users(legacy_sf_id): ${userBySfId.size}件`);

  // members: id → info_acquired_points (固定判定用)
  const infoByMember = new Map<string, string | null>();
  {
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data } = await supabase
        .from('members')
        .select('id, info_acquired_points')
        .is('deleted_at', null)
        .range(from, from + PAGE - 1);
      if (!data || data.length === 0) break;
      for (const m of data as { id: string; info_acquired_points: string | null }[]) {
        infoByMember.set(m.id, m.info_acquired_points);
      }
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }
  console.log(`members(info): ${infoByMember.size}件`);

  // アクティブなフロールール(days_at_time)
  const { data: rules } = await supabase
    .from('flow_rules')
    .select('*')
    .eq('is_active', true)
    .eq('duration_type', 'days_at_time')
    .order('sort_order')
    .order('id')
    .limit(1);
  const activeRule = (rules?.[0] ?? null) as FlowRule | null;
  const nonFixedExpiry = activeRule ? calcExpiresAt(activeRule).toISOString() : null;
  console.log(
    `フロールール: ${activeRule ? `${activeRule.name}(期限 ${nonFixedExpiry})` : 'なし'}\n`,
  );

  const rows = readCsv(csvPath, { trimValues: true });
  console.log(`CSV読込: ${rows.length}行`);

  type Plan = { memberId: string; userId: string | null; expiresAt: string; isFixed: boolean };
  const plans: Plan[] = [];
  let skip = 0;
  let skipNoUser = 0;

  for (const r of rows) {
    const memberId = (r['Member_ID__c'] ?? '').trim();
    const ownerSfId = (r['OwnerId'] ?? '').trim() || null;
    const protectValue = (r['protect__c'] ?? '').trim();
    if (!/^K-\d/.test(memberId)) continue;

    const lv = protectValue.toLowerCase();
    if (!protectValue || lv === 'free' || lv === 'ex sales') {
      skip++;
      continue;
    }

    const isFixedByValue = FIXED_PROTECT_VALUES.has(protectValue);
    const user = ownerSfId ? (userBySfId.get(ownerSfId) ?? null) : null;

    let isFixed = isFixedByValue;
    if (!isFixed && user) {
      if (!user.is_active) isFixed = true;
      else if (user.full_name && FIXED_PROTECT_USER_NAMES.has(user.full_name)) isFixed = true;
    }
    if (!isFixed && user) {
      const info = infoByMember.get(memberId);
      if (info && FIXED_ACQUIRE_KEYWORDS.some((kw) => info.includes(kw))) isFixed = true;
    }

    const userId = user?.id ?? null;
    if (!isFixed && !userId) {
      skipNoUser++;
      continue;
    }

    const expiresAt = isFixed ? FIXED_PROTECT_EXPIRES : nonFixedExpiry;
    if (!expiresAt) {
      skipNoUser++;
      continue;
    }
    plans.push({ memberId, userId, expiresAt, isFixed });
  }

  const fixedCount = plans.filter((p) => p.isFixed).length;
  const normalCount = plans.length - fixedCount;
  console.log(`\n対象: 更新=${plans.length} (固定=${fixedCount} / 通常=${normalCount})`);
  console.log(`スキップ: free/ex sales/空=${skip}, ユーザー未発見=${skipNoUser}`);

  if (args.dryRun) {
    console.log('\n--dry-run: DB書き込みなし');
    for (const p of plans.slice(0, 5)) console.log('  ', JSON.stringify(p));
    return;
  }

  let updated = 0;
  let failed = 0;
  for (let i = 0; i < plans.length; i++) {
    const p = plans[i]!;
    const { error } = await supabase
      .from('members')
      .update({
        protect_by_user_id: p.userId,
        protect_expires_at: p.expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', p.memberId)
      .is('deleted_at', null);
    if (error) failed++;
    else updated++;
    if ((i + 1) % 200 === 0) process.stdout.write(`\r  更新中: ${i + 1}/${plans.length}`);
  }
  console.log(`\n\n完了: 更新=${updated}, 失敗=${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
