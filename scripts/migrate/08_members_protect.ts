/**
 * プロテクトCSV取込スクリプト
 * 顧客情報プロテクト.csv → members.protect_by_user_id / protect_expires_at
 *
 * 使い方:
 *   pnpm migrate:protect [--dry-run] [--csv /path/to/file.csv]
 */

import fs from 'node:fs';
import { createMigrateClient } from './lib/db';

const FIXED_PROTECT_EXPIRES = '2099-01-01T15:00:00.000Z';
const FIXED_PROTECT_VALUES = new Set(['会社プロテクト']);
const FIXED_PROTECT_NAMES = new Set(['守田 和之', '守田 和幸', '植田 雄輝']);
const FIXED_ACQUIRE_KEYWORDS = ['既存顧客からの紹介', 'リスト外'];
// free/ex sales の場合に設定するユーザーID(hirapro777@gmail.com)
const FREE_USER_ID = 'd6ab8478-da1e-491c-b76c-c58147c3b056';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const csvIdx = args.indexOf('--csv');
const csvPath =
  csvIdx >= 0 && args[csvIdx + 1]
    ? args[csvIdx + 1]!
    : '/Users/takaya/Desktop/csv/顧客情報プロテクト.csv';

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = (lines[0] ?? '').split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map((line) => {
    const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? '';
    });
    return row;
  });
}

async function fetchNormalExpiresAt(
  supabase: ReturnType<typeof createMigrateClient>,
): Promise<string | null> {
  const { data } = await supabase
    .from('flow_rules')
    .select('duration_value, duration_type, reset_hour, reset_minute')
    .eq('is_active', true);
  const rule = (data ?? []).find(
    (r: { duration_type: string; duration_value: number }) =>
      r.duration_type === 'days_at_time' && r.duration_value > 0,
  ) as { duration_value: number; reset_hour: number; reset_minute: number } | undefined;
  if (!rule) return null;
  // フロールールの reset_hour:reset_minute (通常 00:00 JST) で N日後を計算する。
  // 本スクリプトはローカル(JST)で実行されるため setHours はそのまま JST 時刻になる。
  const d = new Date();
  d.setDate(d.getDate() + rule.duration_value);
  d.setHours(rule.reset_hour ?? 0, rule.reset_minute ?? 0, 0, 0);
  return d.toISOString();
}

async function main() {
  const supabase = createMigrateClient();

  console.log(`\n[protect import] ${dryRun ? '★ DRY-RUN ★' : '本番実行'}`);
  console.log(`CSV: ${csvPath}\n`);

  if (!fs.existsSync(csvPath)) {
    console.error(`CSV ファイルが見つかりません: ${csvPath}`);
    process.exit(1);
  }

  const { data: allUsers, error: userErr } = await supabase
    .from('users')
    .select('id, full_name, legacy_sf_id, is_active')
    .is('deleted_at', null);
  if (userErr) {
    console.error('users 取得失敗:', userErr.message);
    process.exit(1);
  }

  const userBySfId = new Map<
    string,
    { id: string; full_name: string | null; is_active: boolean }
  >();
  for (const u of allUsers ?? []) {
    if (u.legacy_sf_id) userBySfId.set(u.legacy_sf_id, u);
  }
  console.log(`ユーザーキャッシュ: ${userBySfId.size} 件`);

  const normalExpiresAt = await fetchNormalExpiresAt(supabase);
  console.log(`通常プロテクト期限: ${normalExpiresAt ?? '(フロールールなし)'}`);

  // 会員情報(info_acquired_points)を全件キャッシュ。
  // Supabase の既定行数上限(1000)に当たると固定プロテクト判定が漏れるため、ページングで全件取得する。
  const infoMap = new Map<string, string | null>();
  {
    let offset = 0;
    const PAGE = 1000;
    while (true) {
      const { data } = await supabase
        .from('members')
        .select('id, info_acquired_points')
        .is('deleted_at', null)
        .range(offset, offset + PAGE - 1);
      if (!data || data.length === 0) break;
      for (const m of data) infoMap.set(m.id, m.info_acquired_points ?? null);
      offset += PAGE;
      if (data.length < PAGE) break;
    }
  }
  console.log(`会員情報キャッシュ: ${infoMap.size} 件\n`);

  const rows = parseCsv(fs.readFileSync(csvPath, 'utf-8'));
  console.log(`CSV 行数: ${rows.length} 行\n`);

  let freeCount = 0,
    fixedCount = 0,
    normalCount = 0,
    errorCount = 0,
    updated = 0;
  const errList: string[] = [];
  // expiresAt=null は free登録(NULL)
  const updates: {
    memberId: string;
    userId: string | null;
    expiresAt: string | null;
    isFixed: boolean;
  }[] = [];

  for (const row of rows) {
    const memberId = (row['Member_ID__c'] ?? '').trim();
    const ownerSfId = (row['OwnerId'] ?? '').trim();
    const protectVal = (row['protect__c'] ?? '').trim();

    if (!memberId) {
      errorCount++;
      continue;
    }

    const lv = protectVal.toLowerCase();
    // free / ex sales → freeユーザー(hirapro777@gmail.com)で登録、期限なし
    if (!protectVal || lv === 'free' || lv === 'ex sales') {
      updates.push({ memberId, userId: FREE_USER_ID, expiresAt: null, isFixed: false });
      freeCount++;
      continue;
    }

    const isFixedByVal = FIXED_PROTECT_VALUES.has(protectVal);
    const user = ownerSfId ? (userBySfId.get(ownerSfId) ?? null) : null;
    let isFixed = isFixedByVal;

    if (!isFixed && user) {
      if (!user.is_active) isFixed = true;
      else if (user.full_name && FIXED_PROTECT_NAMES.has(user.full_name)) isFixed = true;
    }
    if (!isFixed && user) {
      const info = infoMap.get(memberId) ?? '';
      for (const kw of FIXED_ACQUIRE_KEYWORDS) {
        if (info.includes(kw)) {
          isFixed = true;
          break;
        }
      }
    }

    const userId = user?.id ?? null;
    if (!isFixed && !userId) {
      freeCount++;
      errList.push(`${memberId}: ユーザー未発見(OwnerId=${ownerSfId})→free登録`);
      updates.push({ memberId, userId: FREE_USER_ID, expiresAt: null, isFixed: false });
      continue;
    }

    const expiresAt = isFixed ? FIXED_PROTECT_EXPIRES : normalExpiresAt;
    if (!expiresAt) {
      freeCount++;
      errList.push(`${memberId}: フロールールなし→free登録`);
      updates.push({ memberId, userId: FREE_USER_ID, expiresAt: null, isFixed: false });
      continue;
    }

    updates.push({ memberId, userId, expiresAt, isFixed });
    if (isFixed) fixedCount++;
    else normalCount++;
  }

  console.log('集計:');
  console.log(`  free登録 (free/ex sales):        ${freeCount}`);
  console.log(`  固定プロテクト対象:              ${fixedCount}`);
  console.log(`  通常プロテクト対象:              ${normalCount}`);
  console.log(`  エラー行:                        ${errorCount}`);
  console.log(`  DB更新予定:                      ${updates.length}\n`);

  if (dryRun) {
    console.log('DRY-RUN: DB更新はスキップ。--dry-run を外すと本番実行します。\n');
    console.log('更新サンプル(最大10件):');
    for (const u of updates.slice(0, 10)) {
      console.log(
        `  ${u.memberId} → userId=${u.userId ?? 'null(固定)'} expires=${u.expiresAt} fixed=${u.isFixed}`,
      );
    }
    if (errList.length) {
      console.log(`\n未発見ユーザー等 (${errList.length}件、最大10件表示):`);
      errList.slice(0, 10).forEach((e) => console.log(' ', e));
    }
    return;
  }

  // ユーザーID+期限でグループ化してバルク更新（1件ずつではなくIN句で一括）
  console.log('DB 書き込み開始 (バルク更新)...');
  const groupMap = new Map<string, string[]>();
  for (const u of updates) {
    const key = `${u.userId ?? 'null'}|${u.expiresAt ?? 'null'}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(u.memberId);
  }
  console.log(`  更新グループ数: ${groupMap.size}`);

  const ID_CHUNK = 500; // IN句は500件ずつ
  for (const [key, ids] of groupMap) {
    const [userId, expiresAt] = key.split('|');
    const payload = {
      protect_by_user_id: userId === 'null' ? null : userId,
      protect_expires_at: expiresAt === 'null' ? null : expiresAt,
      updated_at: new Date().toISOString(),
    };
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const chunk = ids.slice(i, i + ID_CHUNK);
      const { error, count } = await supabase
        .from('members')
        .update(payload)
        .in('id', chunk)
        .is('deleted_at', null);
      if (error) {
        errList.push(`グループ${key} chunk${i}: ${error.message}`);
        errorCount += chunk.length;
      } else {
        updated += count ?? chunk.length;
      }
    }
    process.stdout.write(`\r  ${updated}/${updates.length} 件完了...`);
  }

  console.log(`\n\n完了:`);
  console.log(`  更新成功: ${updated} 件 (固定: ${fixedCount}, 通常: ${normalCount})`);
  console.log(`  エラー:   ${errorCount} 件`);
  if (errList.length) {
    console.log('\nエラー詳細(最大20件):');
    errList.slice(0, 20).forEach((e) => console.log(' ', e));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
