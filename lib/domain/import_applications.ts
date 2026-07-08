'use server';

/**
 * 申込(applications)専用 取込 Server Actions (#1/#2 共通 / admin 限定 / CLAUDE.md §5.6, §6)
 *
 * - 申込情報ID→id、投資案件→project_id(案件名解決)、会員ID→member_id(既存のみ・必須)
 * - 問合せ管理ID→inquiry_id(既存のみ)、永久担当/申込獲得者→owner/acquirer 名前解決
 * - 案件固有列は extra(JSONB)。申込ID(M-)で upsert
 *
 * 行変換は lib/import/applications_map.ts(純粋関数)を使用。
 */

import {
  type AppRecord,
  type AppResolveMaps,
  applicationsExtraHeaderKeys,
  convertApplicationRow,
} from '@/lib/import/applications_map';
import { type RowError, parseCsv } from '@/lib/import/parse';
// 取込はサービスロールで実行(auth.uid()=null → 監査ログに取込を記録しない)。
import { createServiceRoleClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { getCurrentUser } from './auth';
import { registerExtraFields } from './field_registry';
import type { CommitResult, PreviewResult } from './import_actions';

const BATCH = 200;
const MAX_ROWS = 60_000;

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

function distinctValues(rows: Array<Record<string, string>>, header: string): string[] {
  const s = new Set<string>();
  for (const r of rows) {
    const v = (r[header] ?? '').trim();
    if (v) s.add(v);
  }
  return [...s];
}

async function idsInTable(supabase: Db, table: string, ids: string[]): Promise<Set<string>> {
  const set = new Set<string>();
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    if (chunk.length === 0) continue;
    const { data } = await supabase.from(table).select('id').in('id', chunk);
    for (const r of (data ?? []) as Array<{ id: string }>) set.add(String(r.id));
  }
  return set;
}

async function buildResolveMaps(
  supabase: Db,
  rawRows: Array<Record<string, string>>,
): Promise<AppResolveMaps> {
  // 案件名 → id
  const projectNameToId = new Map<string, string>();
  const { data: projects } = await supabase.from('projects').select('id, name');
  for (const p of (projects ?? []) as Array<{ id: string; name: string | null }>) {
    if (p.name) projectNameToId.set(p.name, String(p.id));
  }

  // 担当者
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

  const validMemberIds = await idsInTable(supabase, 'members', distinctValues(rawRows, '会員ID'));
  const validInquiryIds = await idsInTable(
    supabase,
    'inquiries',
    distinctValues(rawRows, '問合せ管理ID'),
  );

  return { projectNameToId, validMemberIds, validInquiryIds, ownerByFullName, ownerByLastName };
}

function convertAll(
  rawRows: Array<Record<string, string>>,
  maps: AppResolveMaps,
): { records: AppRecord[]; errors: RowError[] } {
  const errors: RowError[] = [];
  const byId = new Map<string, AppRecord>();
  rawRows.forEach((raw, i) => {
    const out = convertApplicationRow(raw, i + 1, maps);
    if (out.error) {
      errors.push({ row: i + 1, message: out.error });
      return;
    }
    if (out.record) byId.set(out.record.id, out.record);
  });
  return { records: [...byId.values()], errors };
}

export async function previewApplicationsCsv(
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

  const supabase = createServiceRoleClient();
  const maps = await buildResolveMaps(supabase, rawRows);
  const { records, errors } = convertAll(rawRows, maps);
  const existing = await idsInTable(
    supabase,
    'applications',
    records.map((r) => r.id),
  );

  let newCount = 0;
  let updateCount = 0;
  let skippedCount = 0;
  const sample: PreviewResult['sample'] = [];
  for (const r of records) {
    const isUpdate = existing.has(r.id);
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
    if (sample!.length < 20) sample!.push({ row: 0, id: r.id, mode });
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
      ['申込情報ID', '投資案件', '会員ID', 'ステータス', '入金額', '永久担当'].includes(h),
    ),
    ignoredHeaders: [],
    sample,
  };
}

export async function commitApplicationsCsv(
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

  const supabase = createServiceRoleClient();
  const maps = await buildResolveMaps(supabase, rawRows);
  const { records, errors } = convertAll(rawRows, maps);
  if (records.length === 0) {
    return {
      ok: false,
      error: '取込可能な有効行がありません(申込情報ID/会員ID/申込日 を確認してください)',
      errorCount: errors.length,
      errors: errors.slice(0, 50),
    };
  }

  // 新規/更新の内訳を出すため、常に既存IDを照会する
  const existing = await idsInTable(
    supabase,
    'applications',
    records.map((r) => r.id),
  );

  let targetRecords = records;
  let skippedCount = 0;
  if (updateOnly) {
    const before = targetRecords.length;
    targetRecords = targetRecords.filter((r) => existing.has(r.id));
    skippedCount = before - targetRecords.length;
  }
  const newCount = targetRecords.filter((r) => !existing.has(r.id)).length;
  const updateCount = targetRecords.length - newCount;

  let upserted = 0;
  for (let i = 0; i < targetRecords.length; i += BATCH) {
    const batch = targetRecords.slice(i, i + BATCH);
    const { error } = await supabase.from('applications').upsert(batch, { onConflict: 'id' });
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

  // CSVヘッダー基準で「標準カラム以外の全列」をフィールド管理へ自動登録。
  // ※ 値から集めると「全行が空の新列」が登録されないため、ヘッダーから拾う。
  try {
    await registerExtraFields('applications', applicationsExtraHeaderKeys(rawRows));
  } catch {
    /* フィールド登録の失敗は取込本体に影響させない */
  }

  revalidatePath('/applications');
  return {
    ok: true,
    upserted,
    newCount,
    updateCount,
    skippedCount,
    errorCount: errors.length,
    errors: errors.slice(0, 50),
  };
}
