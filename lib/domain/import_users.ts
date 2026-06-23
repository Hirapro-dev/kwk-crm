'use server';

/**
 * 従業員(users)専用 取込 Server Actions (#2 突発アップロード / admin 限定 / CLAUDE.md §5.1, §6)
 *
 * - email 必須。legacy_sf_id → email の順で既存ユーザーを突合し id を再利用、無ければ新規UUID
 * - role はマッピングで常に有効値。氏名は full_name か「姓 名」で補完
 * - upsert は id(uuid PK)で突合(既存は同じidで更新、新規は採番idで挿入)
 *
 * 行変換は lib/import/users_map.ts(純粋関数)を使用。
 */

import { type RowError, parseCsv } from '@/lib/import/parse';
import { type UserRecord, type UserResolveMaps, convertUserRow } from '@/lib/import/users_map';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { getCurrentUser } from './auth';
import type { CommitResult, PreviewResult } from './import_actions';

const BATCH = 200;
const MAX_ROWS = 10_000; // 従業員は少数(〜数百)想定

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

async function buildResolveMaps(supabase: Db): Promise<UserResolveMaps> {
  const idByLegacy = new Map<string, string>();
  const idByEmail = new Map<string, string>();
  const { data } = await supabase.from('users').select('id, legacy_sf_id, email');
  for (const u of (data ?? []) as Array<{
    id: string;
    legacy_sf_id: string | null;
    email: string | null;
  }>) {
    if (u.legacy_sf_id) idByLegacy.set(u.legacy_sf_id, u.id);
    if (u.email) idByEmail.set(u.email.toLowerCase(), u.id);
  }
  return { idByLegacy, idByEmail };
}

function convertAll(
  rawRows: Array<Record<string, string>>,
  maps: UserResolveMaps,
): { records: UserRecord[]; existedKeys: Set<string>; errors: RowError[] } {
  const errors: RowError[] = [];
  const byKey = new Map<string, UserRecord>();
  const existedKeys = new Set<string>();
  rawRows.forEach((raw, i) => {
    const out = convertUserRow(raw, i + 1, maps);
    if (out.error) {
      errors.push({ row: i + 1, message: out.error });
      return;
    }
    if (out.record && out.dedupKey) {
      byKey.set(out.dedupKey, out.record);
      if (out.existed) existedKeys.add(out.dedupKey);
    }
  });
  return { records: [...byKey.values()], existedKeys, errors };
}

export async function previewUsersCsv(
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
  const maps = await buildResolveMaps(supabase);
  const { records, errors } = convertAll(rawRows, maps);

  let newCount = 0;
  let updateCount = 0;
  let skippedCount = 0;
  const sample: PreviewResult['sample'] = [];
  for (const r of records) {
    // 既存判定: 解決した id が既存ユーザーのものか
    const isUpdate =
      (r.legacy_sf_id ? maps.idByLegacy.get(r.legacy_sf_id) === r.id : false) ||
      maps.idByEmail.get(r.email) === r.id;
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
    if (sample.length < 20) sample.push({ row: 0, id: r.email, mode });
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
      ['ユーザーID', 'Id', 'メール', 'Email', '姓', '名', '氏名', '権限', '有効'].includes(h),
    ),
    ignoredHeaders: [],
    sample,
  };
}

export async function commitUsersCsv(
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
  const maps = await buildResolveMaps(supabase);
  const { records, existedKeys, errors } = convertAll(rawRows, maps);
  if (records.length === 0) {
    return {
      ok: false,
      error: '取込可能な有効行がありません(メール列を確認してください)',
      errorCount: errors.length,
      errors: errors.slice(0, 50),
    };
  }

  // 更新のみモード: 既存ユーザーの行だけに絞る
  let targetRecords = records;
  let skippedCount = 0;
  if (updateOnly) {
    const before = targetRecords.length;
    targetRecords = targetRecords.filter(
      (r) =>
        (r.legacy_sf_id && maps.idByLegacy.get(r.legacy_sf_id) === r.id) ||
        maps.idByEmail.get(r.email) === r.id,
    );
    skippedCount = before - targetRecords.length;
  }
  void existedKeys;

  let upserted = 0;
  for (let i = 0; i < targetRecords.length; i += BATCH) {
    const batch = targetRecords.slice(i, i + BATCH);
    const { error } = await supabase.from('users').upsert(batch, { onConflict: 'id' });
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

  revalidatePath('/settings/users');
  revalidatePath('/admin/users');
  return {
    ok: true,
    upserted,
    skippedCount,
    errorCount: errors.length,
    errors: errors.slice(0, 50),
  };
}
