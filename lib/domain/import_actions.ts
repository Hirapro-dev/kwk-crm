'use server';

/**
 * CSV 取込 Server Actions (#2 突発アップロード / admin 限定)。
 *
 * previewImport: 書き込まずに検証し「新規/更新/エラー件数 + サンプル」を返す(ドライラン)。
 * commitImport : 検証OKの行を upsert(idField で突合、無ければ新規)。
 *
 * 安全策:
 *   - admin のみ
 *   - ホワイトリスト(IMPORT_OBJECTS)に無いオブジェクト/カラムは扱わない
 *   - CSV に存在する列のみ更新(存在しない列は既存値を保持)
 *   - RLS は実行ユーザー(admin)権限で適用される
 */

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { mapAndValidate, parseCsv, type RowError } from '@/lib/import/parse';
import { IMPORT_OBJECTS } from '@/lib/import/schema';
import { getCurrentUser } from './auth';
import { commitInquiriesCsv, previewInquiriesCsv } from './import_inquiries';
import { commitMembersCsv, previewMembersCsv } from './import_members';

const MAX_ROWS = 60_000; // バルクUIの上限(会員約23,580件に余裕を持たせる。超過分はスクリプト/分割を案内)
const BATCH = 500;

export interface PreviewResult {
  ok: boolean;
  error?: string;
  totalRows?: number;
  validCount?: number;
  newCount?: number;
  updateCount?: number;
  /** 更新のみモードで、新規IDのため取込されない件数 */
  skippedCount?: number;
  errorCount?: number;
  /** 先頭のエラー(最大50件) */
  errors?: RowError[];
  /** 取込対象になる列ラベル */
  targetLabels?: string[];
  /** 取込されない無視列 */
  ignoredHeaders?: string[];
  /** プレビュー用サンプル(先頭20行、id + 状態) */
  sample?: Array<{ row: number; id: string; mode: '新規' | '更新' | 'スキップ' }>;
}

export interface CommitResult {
  ok: boolean;
  error?: string;
  upserted?: number;
  /** 更新のみモードで、新規IDのためスキップした件数 */
  skippedCount?: number;
  errorCount?: number;
  errors?: RowError[];
}

async function assertAdmin(): Promise<string | null> {
  const me = await getCurrentUser();
  if (me.role !== 'admin') return 'データ取込は admin のみ可能です';
  return null;
}

/** id 群のうち既に存在するものを返す(チャンク IN) */
async function findExistingIds(
  table: string,
  idField: string,
  ids: string[],
): Promise<Set<string>> {
  const supabase = await createClient();
  const existing = new Set<string>();
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from(table)
      .select(idField)
      .in(idField, chunk);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      const v = (r as Record<string, unknown>)[idField];
      if (v != null) existing.add(String(v));
    }
  }
  return existing;
}

export async function previewImport(
  object: string,
  csvText: string,
  updateOnly = false,
): Promise<PreviewResult> {
  const adminErr = await assertAdmin();
  if (adminErr) return { ok: false, error: adminErr };

  // 専用ハンドラに委譲(実CSVヘッダー対応 / 架電NG分離 / 担当解決 / extra・フォーム解決)
  if (object === 'members') return previewMembersCsv([csvText], updateOnly);
  if (object === 'inquiries') return previewInquiriesCsv([csvText], updateOnly);

  const def = IMPORT_OBJECTS[object];
  if (!def) return { ok: false, error: '不明なオブジェクトです' };

  let rawRows: Array<Record<string, string>>;
  try {
    rawRows = parseCsv(csvText);
  } catch (e) {
    return { ok: false, error: `CSV解析に失敗: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (rawRows.length === 0) return { ok: false, error: 'データ行がありません' };
  if (rawRows.length > MAX_ROWS) {
    return { ok: false, error: `行数が上限(${MAX_ROWS.toLocaleString()})を超えています` };
  }

  const mapped = mapAndValidate(def, rawRows);
  if (mapped.presentFields.length <= 1) {
    return {
      ok: false,
      error: `取込対象の列が見つかりません。テンプレートのヘッダー(${def.fields.map((f) => f.label).slice(0, 4).join(' / ')} 等)を使用してください`,
    };
  }

  let existing: Set<string>;
  try {
    existing = await findExistingIds(
      def.table,
      def.idField,
      mapped.records.map((r) => r.id),
    );
  } catch (e) {
    return { ok: false, error: `既存データ照会に失敗: ${e instanceof Error ? e.message : String(e)}` };
  }

  let newCount = 0;
  let updateCount = 0;
  let skippedCount = 0;
  const sample: PreviewResult['sample'] = [];
  for (const r of mapped.records) {
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
    if (sample.length < 20) sample.push({ row: r.row, id: r.id, mode });
  }

  return {
    ok: true,
    totalRows: mapped.totalRows,
    // 取込対象になる行数(更新のみ時はスキップ分を除く)
    validCount: updateOnly ? updateCount : mapped.records.length,
    newCount,
    updateCount,
    skippedCount,
    errorCount: mapped.errors.length,
    errors: mapped.errors.slice(0, 50),
    targetLabels: mapped.presentFields.map((f) => f.label),
    ignoredHeaders: mapped.ignoredHeaders,
    sample,
  };
}

export async function commitImport(
  object: string,
  csvText: string,
  updateOnly = false,
): Promise<CommitResult> {
  const adminErr = await assertAdmin();
  if (adminErr) return { ok: false, error: adminErr };

  // 専用ハンドラに委譲
  if (object === 'members') return commitMembersCsv([csvText], updateOnly);
  if (object === 'inquiries') return commitInquiriesCsv([csvText], updateOnly);

  const def = IMPORT_OBJECTS[object];
  if (!def) return { ok: false, error: '不明なオブジェクトです' };

  let rawRows: Array<Record<string, string>>;
  try {
    rawRows = parseCsv(csvText);
  } catch (e) {
    return { ok: false, error: `CSV解析に失敗: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (rawRows.length === 0) return { ok: false, error: 'データ行がありません' };
  if (rawRows.length > MAX_ROWS) {
    return { ok: false, error: `行数が上限(${MAX_ROWS.toLocaleString()})を超えています` };
  }

  const mapped = mapAndValidate(def, rawRows);
  if (mapped.records.length === 0) {
    return {
      ok: false,
      error: '取込可能な有効行がありません',
      errorCount: mapped.errors.length,
      errors: mapped.errors.slice(0, 50),
    };
  }

  const supabase = await createClient();
  let upserted = 0;
  let skippedCount = 0;

  // 更新のみモード: 既存IDの行だけに絞る(新規IDはスキップ)
  let targetRecords = mapped.records;
  if (updateOnly) {
    let existing: Set<string>;
    try {
      existing = await findExistingIds(
        def.table,
        def.idField,
        mapped.records.map((r) => r.id),
      );
    } catch (e) {
      return { ok: false, error: `既存データ照会に失敗: ${e instanceof Error ? e.message : String(e)}` };
    }
    const before = targetRecords.length;
    targetRecords = targetRecords.filter((r) => existing.has(r.id));
    skippedCount = before - targetRecords.length;
  }

  const rows = targetRecords.map((r) => r.data);
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from(def.table)
      .upsert(batch, { onConflict: def.idField });
    if (error) {
      return {
        ok: false,
        error: `${i + 1}〜${i + batch.length}行目の保存に失敗: ${error.message}`,
        upserted,
        skippedCount,
      };
    }
    upserted += batch.length;
  }

  // 対象オブジェクトの一覧を再検証
  revalidatePath(`/${def.object}`);
  return {
    ok: true,
    upserted,
    skippedCount,
    errorCount: mapped.errors.length,
    errors: mapped.errors.slice(0, 50),
  };
}
