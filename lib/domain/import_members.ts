'use server';

/**
 * 会員(members)専用 取込 Server Actions (#1/#2 共通 / admin 限定 / CLAUDE.md §5.4, §6)
 *
 * - 実CSVヘッダー(会員氏名 等)→カラムをマッピング
 * - 電話番号1 末尾の「架電NG」を do_not_call に分離
 * - 永久担当 を users 名前解決(owner_id) + owner_name_raw 原文保持
 * - 会員ID(K-)で upsert。会員氏名は NOT NULL のため空はエラー(取込対象外)
 *
 * 行変換は lib/import/members_map.ts(純粋関数)を使用。
 */

import { type MemberRecord, type OwnerMaps, convertMemberRow } from '@/lib/import/members_map';
import { type RowError, parseCsv } from '@/lib/import/parse';
// 取込(preview/commit)はサービスロールで実行する。
// commit の upsert が auth.uid()=null になり、監査ログ(audit_logs)に
// 取込レコードが1件ずつ記録されるのを防ぐ(取込は監査対象外/CLAUDE.md §5.12)。
import { createServiceRoleClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { getCurrentUser } from './auth';
import { registerExtraFields } from './field_registry';
import type { CommitResult, PreviewResult } from './import_actions';

// extra に多数の列(案件別利用額170列超)が入りペイロードが大きくなるため小さめ
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

async function loadOwnerMaps(supabase: Db): Promise<OwnerMaps> {
  const byFullName = new Map<string, string>();
  const byLastName = new Map<string, string>();
  const { data } = await supabase.from('users').select('id, full_name, last_name');
  for (const u of (data ?? []) as Array<{
    id: string;
    full_name: string | null;
    last_name: string | null;
  }>) {
    if (u.full_name) byFullName.set(u.full_name, u.id);
    if (u.last_name && !byLastName.has(u.last_name)) byLastName.set(u.last_name, u.id);
  }
  return { byFullName, byLastName };
}

function convertAll(
  rawRows: Array<Record<string, string>>,
  ownerMaps: OwnerMaps,
): { records: MemberRecord[]; errors: RowError[] } {
  const errors: RowError[] = [];
  const byId = new Map<string, MemberRecord>();
  rawRows.forEach((raw, i) => {
    const out = convertMemberRow(raw, i + 1, ownerMaps);
    if (out.error) {
      errors.push({ row: i + 1, message: out.error });
      return;
    }
    if (out.record) byId.set(out.record.id, out.record);
  });
  return { records: [...byId.values()], errors };
}

async function existingIds(supabase: Db, ids: string[]): Promise<Set<string>> {
  const set = new Set<string>();
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    if (chunk.length === 0) continue;
    const { data } = await supabase.from('members').select('id').in('id', chunk);
    for (const r of (data ?? []) as Array<{ id: string }>) set.add(String(r.id));
  }
  return set;
}

export async function previewMembersCsv(
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
  const ownerMaps = await loadOwnerMaps(supabase);
  const { records, errors } = convertAll(rawRows, ownerMaps);
  const existing = await existingIds(
    supabase,
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
      [
        '会員ID',
        '会員氏名',
        '会員かな',
        'Eメール1',
        '電話番号1',
        '住所(フル)',
        '永久担当',
        '総合計額',
      ].includes(h),
    ),
    ignoredHeaders: [],
    sample,
  };
}

export async function commitMembersCsv(
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
  const ownerMaps = await loadOwnerMaps(supabase);
  const { records, errors } = convertAll(rawRows, ownerMaps);
  if (records.length === 0) {
    return {
      ok: false,
      error: '取込可能な有効行がありません(会員ID/会員氏名 を確認してください)',
      errorCount: errors.length,
      errors: errors.slice(0, 50),
    };
  }

  // 新規/更新の内訳を出すため、常に既存IDを照会する
  const existing = await existingIds(
    supabase,
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
    const { error } = await supabase.from('members').upsert(batch, { onConflict: 'id' });
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

  // extra に入った新カラムをフィールド管理へ自動登録(失敗しても取込は成功扱い)
  try {
    const keys = new Set<string>();
    for (const r of records) {
      for (const k of Object.keys((r.extra as Record<string, unknown>) ?? {})) keys.add(k);
    }
    await registerExtraFields('members', [...keys]);
  } catch {
    /* フィールド登録の失敗は取込本体に影響させない */
  }

  revalidatePath('/members');
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
