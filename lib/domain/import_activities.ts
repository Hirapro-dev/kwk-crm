'use server';

/**
 * 対応歴(activities)専用 取込 Server Actions (#2 突発アップロード / admin 限定 / CLAUDE.md §5.7, §6)
 *
 * - 会員ID(K-)→member_id(既存のみ)、担当→owner_id(名前解決)
 * - 行内容のハッシュで legacy_sf_id を生成し、それで upsert(同一内容は重複しない)
 * - 「対応歴ID」列があればそれを legacy_sf_id として優先
 * - activities に extra 列は無いため未マッピング列は無視
 *
 * 行変換は lib/import/activities_map.ts(純粋関数)を使用。
 */

import {
  ACTIVITY_MEMBER_HEADERS,
  type ActivityRecord,
  type ActivityResolveMaps,
  convertActivityRow,
} from '@/lib/import/activities_map';
import { type RowError, parseCsv } from '@/lib/import/parse';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { getCurrentUser } from './auth';
import type { CommitResult, PreviewResult } from './import_actions';

const BATCH = 500;
const MAX_ROWS = 200_000; // 対応歴は大量になりがちなので上限を高めに

// biome-ignore lint/suspicious/noExplicitAny: Tables 型が空のため supabase クライアントは緩い型
type Db = any;

async function assertAdmin(): Promise<string | null> {
  const me = await getCurrentUser();
  if (me.role !== 'admin') return 'データ取込は admin のみ可能です';
  return null;
}

function parseAll(csvTexts: string[]): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = [];
  for (const t of csvTexts) {
    if (t && t.trim() !== '') rows.push(...parseCsv(t));
  }
  return rows;
}

/** 会員ID列(別名含む)から distinct な値を集める */
function distinctMemberIds(rows: Array<Record<string, string>>): string[] {
  const s = new Set<string>();
  for (const r of rows) {
    for (const h of ACTIVITY_MEMBER_HEADERS) {
      const v = (r[h] ?? '').trim();
      if (v) {
        s.add(v);
        break;
      }
    }
  }
  return [...s];
}

async function membersInTable(supabase: Db, ids: string[]): Promise<Set<string>> {
  const set = new Set<string>();
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    if (chunk.length === 0) continue;
    const { data } = await supabase.from('members').select('id').in('id', chunk);
    for (const r of (data ?? []) as Array<{ id: string }>) set.add(String(r.id));
  }
  return set;
}

/** legacy_sf_id 群のうち既に存在するものを返す */
async function existingLegacyIds(supabase: Db, ids: string[]): Promise<Set<string>> {
  const set = new Set<string>();
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    if (chunk.length === 0) continue;
    const { data } = await supabase
      .from('activities')
      .select('legacy_sf_id')
      .in('legacy_sf_id', chunk);
    for (const r of (data ?? []) as Array<{ legacy_sf_id: string | null }>) {
      if (r.legacy_sf_id) set.add(String(r.legacy_sf_id));
    }
  }
  return set;
}

async function buildResolveMaps(
  supabase: Db,
  rawRows: Array<Record<string, string>>,
): Promise<ActivityResolveMaps> {
  const ownerByFullName = new Map<string, string>();
  const ownerByLastName = new Map<string, string>();
  const { data: users } = await supabase.from('users').select('id, full_name, last_name');
  for (const u of (users ?? []) as Array<{
    id: string;
    full_name: string | null;
    last_name: string | null;
  }>) {
    if (u.full_name) ownerByFullName.set(u.full_name, u.id);
    if (u.last_name && !ownerByLastName.has(u.last_name)) ownerByLastName.set(u.last_name, u.id);
  }
  const validMemberIds = await membersInTable(supabase, distinctMemberIds(rawRows));
  return { validMemberIds, ownerByFullName, ownerByLastName };
}

function convertAll(
  rawRows: Array<Record<string, string>>,
  maps: ActivityResolveMaps,
): { records: ActivityRecord[]; errors: RowError[] } {
  const errors: RowError[] = [];
  // 同一 legacy_sf_id は1件にまとめる(同一内容の重複を排除)
  const byKey = new Map<string, ActivityRecord>();
  rawRows.forEach((raw, i) => {
    const out = convertActivityRow(raw, i + 1, maps);
    if (out.error) {
      errors.push({ row: i + 1, message: out.error });
      return;
    }
    if (out.record) byKey.set(out.record.legacy_sf_id, out.record);
  });
  return { records: [...byKey.values()], errors };
}

export async function previewActivitiesCsv(
  csvTexts: string[],
  updateOnly = false,
): Promise<PreviewResult> {
  const adminErr = await assertAdmin();
  if (adminErr) return { ok: false, error: adminErr };

  let rawRows: Array<Record<string, string>>;
  try {
    rawRows = parseAll(csvTexts);
  } catch (e) {
    return { ok: false, error: `CSV解析に失敗: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (rawRows.length === 0) return { ok: false, error: 'データ行がありません' };
  if (rawRows.length > MAX_ROWS) {
    return { ok: false, error: `行数が上限(${MAX_ROWS.toLocaleString()})を超えています` };
  }

  const supabase = await createClient();
  const maps = await buildResolveMaps(supabase, rawRows);
  const { records, errors } = convertAll(rawRows, maps);
  const existing = await existingLegacyIds(
    supabase,
    records.map((r) => r.legacy_sf_id),
  );

  let newCount = 0;
  let updateCount = 0;
  let skippedCount = 0;
  const sample: PreviewResult['sample'] = [];
  for (const r of records) {
    const isUpdate = existing.has(r.legacy_sf_id);
    let mode: '新規' | '更新' | 'スキップ';
    if (isUpdate) {
      updateCount++;
      mode = '更新';
    } else if (updateOnly) {
      skippedCount++;
      mode = 'スキップ';
    } else {
      newCount++;
      mode = '新規';
    }
    if (sample.length < 20) {
      sample.push({ row: 0, id: r.member_id ?? r.legacy_sf_id, mode });
    }
  }

  const headers = rawRows[0] ? Object.keys(rawRows[0]) : [];
  return {
    ok: true,
    totalRows: rawRows.length,
    validCount: updateOnly ? updateCount : records.length,
    newCount,
    updateCount,
    skippedCount,
    errorCount: errors.length,
    errors: errors.slice(0, 50),
    targetLabels: headers.filter((h) =>
      [
        '会員ID',
        'WhoId',
        '担当',
        'OwnerId',
        '大分類',
        'Dbunrui__c',
        'コメント',
        'Description',
        '登録日時',
        'tourokunitiji__c',
      ].includes(h),
    ),
    ignoredHeaders: [],
    sample,
  };
}

export async function commitActivitiesCsv(
  csvTexts: string[],
  updateOnly = false,
): Promise<CommitResult> {
  const adminErr = await assertAdmin();
  if (adminErr) return { ok: false, error: adminErr };

  let rawRows: Array<Record<string, string>>;
  try {
    rawRows = parseAll(csvTexts);
  } catch (e) {
    return { ok: false, error: `CSV解析に失敗: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (rawRows.length === 0) return { ok: false, error: 'データ行がありません' };
  if (rawRows.length > MAX_ROWS) {
    return { ok: false, error: `行数が上限(${MAX_ROWS.toLocaleString()})を超えています` };
  }

  const supabase = await createClient();
  const maps = await buildResolveMaps(supabase, rawRows);
  const { records, errors } = convertAll(rawRows, maps);
  if (records.length === 0) {
    return {
      ok: false,
      error: '取込可能な有効行がありません',
      errorCount: errors.length,
      errors: errors.slice(0, 50),
    };
  }

  let targetRecords = records;
  let skippedCount = 0;
  if (updateOnly) {
    const existing = await existingLegacyIds(
      supabase,
      records.map((r) => r.legacy_sf_id),
    );
    const before = targetRecords.length;
    targetRecords = targetRecords.filter((r) => existing.has(r.legacy_sf_id));
    skippedCount = before - targetRecords.length;
  }

  let upserted = 0;
  for (let i = 0; i < targetRecords.length; i += BATCH) {
    const batch = targetRecords.slice(i, i + BATCH);
    const { error } = await supabase
      .from('activities')
      .upsert(batch, { onConflict: 'legacy_sf_id' });
    if (error) {
      return {
        ok: false,
        error: `${i + 1}〜${i + batch.length}件目の保存に失敗: ${error.message}`,
        upserted,
        skippedCount,
      };
    }
    upserted += batch.length;
  }

  revalidatePath('/activities');
  return {
    ok: true,
    upserted,
    skippedCount,
    errorCount: errors.length,
    errors: errors.slice(0, 50),
  };
}
