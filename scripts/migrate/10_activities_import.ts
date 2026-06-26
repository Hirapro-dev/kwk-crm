/**
 * 対応歴 一括取込スクリプト
 *
 * 入力: activities_template.csv (1.2M行)
 * ヘッダー: 対応歴ID / 会員ID / 対応者 / 接触種別 / 接触内容 / 状態 / 登録日時 / Description
 *
 * - legacy_sf_id (対応歴ID) で既存レコードを上書き、新規は INSERT
 * - 対応者 → owner_id を full_name で解決
 * - ストリーミング処理で500件ずつバルク upsert
 *
 * 使い方:
 *   pnpm tsx scripts/migrate/10_activities_import.ts [--dry-run] [--csv /path/to/file.csv]
 */

import { resolve } from 'node:path';
import { parseArgs } from './lib/args';
import { streamCsv } from './lib/csv_stream';
import { createMigrateClient } from './lib/db';
import { nz, parseJpDateTime } from './lib/normalizers';

const DEFAULT_CSV = '/Volumes/NewSSD/work/独自CRM/crm/csv/extract.csv';
const BATCH_SIZE = 500;

const cliArgs = parseArgs(process.argv.slice(2));
const dryRun = cliArgs.dryRun;
const csvPath = cliArgs.file ?? DEFAULT_CSV;

type ActivityUpsert = {
  legacy_sf_id: string;
  owner_id: string | null;
  member_id: string | null;
  d_bunrui: string | null;
  m_bunrui: string | null;
  s_bunrui: string | null;
  registered_datetime: string | null;
  registered_date: string | null;
  description: string | null;
};

async function main() {
  const supabase = createMigrateClient();

  console.log(`\n[activities import] ${dryRun ? '★ DRY-RUN ★' : '本番実行'}`);
  console.log(`CSV: ${resolve(csvPath)}\n`);

  // ユーザーキャッシュ（対応者名 → UUID）
  const { data: users, error: userErr } = await supabase
    .from('users')
    .select('id, full_name')
    .is('deleted_at', null);
  if (userErr) { console.error('users 取得失敗:', userErr.message); process.exit(1); }

  const userByFullName = new Map<string, string>();
  const userByLastName = new Map<string, string>();
  for (const u of users ?? []) {
    if (u.full_name) {
      userByFullName.set(u.full_name, u.id);
      const lastName = u.full_name.split(/[\s　]/)[0];
      if (lastName) userByLastName.set(lastName, u.id);
    }
  }
  console.log(`ユーザーキャッシュ: ${userByFullName.size} 件`);

  // 有効会員IDキャッシュ
  const validMemberIds = new Set<string>();
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data } = await supabase
      .from('members')
      .select('id')
      .is('deleted_at', null)
      .range(offset, offset + PAGE - 1);
    if (!data || data.length === 0) break;
    for (const m of data) validMemberIds.add(m.id);
    offset += PAGE;
    if (data.length < PAGE) break;
  }
  console.log(`会員キャッシュ: ${validMemberIds.size} 件\n`);

  function resolveOwner(name: string | null): string | null {
    if (!name) return null;
    const n = name.trim();
    if (!n || n.toLowerCase() === 'free') return null;
    return userByFullName.get(n)
      ?? userByLastName.get(n.split(/[\s　]/)[0] ?? '')
      ?? null;
  }

  let batch: ActivityUpsert[] = [];
  let total = 0, inserted = 0, errors = 0;
  let ownerUnresolved = 0;
  let memberUnresolved = 0;

  async function flushBatch() {
    if (batch.length === 0) return;
    if (dryRun) { batch = []; return; }
    const { error } = await supabase
      .from('activities')
      .upsert(batch, { onConflict: 'legacy_sf_id', ignoreDuplicates: false });
    if (error) {
      console.error(`\nバッチエラー(行${total}付近): ${error.message}`);
      errors += batch.length;
    } else {
      inserted += batch.length;
    }
    batch = [];
  }

  await streamCsv(csvPath, async (row) => {
    total++;
    if (total % 50000 === 0) {
      process.stdout.write(`\r  処理中: ${total.toLocaleString()} 行...`);
    }

    const legacyId = nz(row['対応歴ID'] ?? row['legacy_sf_id'] ?? row['Id'] ?? '');
    if (!legacyId) return;

    const memberIdRaw = nz(row['会員ID'] ?? row['member_id'] ?? '');
    const memberId = memberIdRaw && validMemberIds.has(memberIdRaw) ? memberIdRaw : null;
    if (memberIdRaw && !memberId) memberUnresolved++;

    const ownerName = nz(row['対応者'] ?? row['担当'] ?? row['owner_name'] ?? '');
    const ownerId = resolveOwner(ownerName);
    if (ownerName && !ownerId) ownerUnresolved++;

    const datetimeRaw = nz(
      row['登録日時'] ?? row['StartDateTime'] ?? row['registered_datetime'] ?? '',
    );
    const registeredDatetime = parseJpDateTime(datetimeRaw);
    const registeredDate = registeredDatetime ? registeredDatetime.slice(0, 10) : null;

    batch.push({
      legacy_sf_id: legacyId,
      owner_id: ownerId,
      member_id: memberId,
      d_bunrui: nz(row['接触種別'] ?? row['d_bunrui'] ?? ''),
      m_bunrui: nz(row['接触内容'] ?? row['m_bunrui'] ?? ''),
      s_bunrui: nz(row['状態'] ?? row['s_bunrui'] ?? ''),
      registered_datetime: registeredDatetime,
      registered_date: registeredDate,
      description: nz(row['Description'] ?? row['対応詳細'] ?? row['description'] ?? ''),
    });

    if (batch.length >= BATCH_SIZE) {
      await flushBatch();
    }
  });

  await flushBatch();

  console.log(`\n\n完了:`);
  console.log(`  処理行数:         ${total.toLocaleString()} 行`);
  if (dryRun) {
    console.log(`  DRY-RUN: DB書き込みなし`);
  } else {
    console.log(`  upsert成功:       ${inserted.toLocaleString()} 件`);
    console.log(`  エラー:           ${errors} 件`);
  }
  console.log(`  担当者未解決:     ${ownerUnresolved.toLocaleString()} 件`);
  console.log(`  会員ID未解決:     ${memberUnresolved.toLocaleString()} 件`);
}

main().catch((e) => { console.error(e); process.exit(1); });
