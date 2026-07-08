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

import { type Classification, classifyAgainstDb } from '@/lib/import/diff';
import { type RowError, mapAndValidate, parseCsv } from '@/lib/import/parse';
import { IMPORT_OBJECTS } from '@/lib/import/schema';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { getCurrentUser } from './auth';
import { commitActivitiesCsv, previewActivitiesCsv } from './import_activities';
import { commitApplicationsCsv, previewApplicationsCsv } from './import_applications';
import { commitArticleReactionsCsv, previewArticleReactionsCsv } from './import_article_reactions';
import { commitInquiriesCsv, previewInquiriesCsv } from './import_inquiries';
import { commitMembersCsv, previewMembersCsv } from './import_members';
import { commitUsersCsv, previewUsersCsv } from './import_users';
import {
  commitWithdrawalChildrenCsv,
  commitWithdrawalParentsCsv,
  previewWithdrawalChildrenCsv,
  previewWithdrawalParentsCsv,
} from './import_withdrawals';

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
  /** 実際に取り込んだ行のうち、新規作成された件数 */
  newCount?: number;
  /** 実際に取り込んだ行のうち、既存を更新した件数 */
  updateCount?: number;
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

export async function previewImport(
  object: string,
  csvText: string,
  updateOnly = false,
): Promise<PreviewResult> {
  const adminErr = await assertAdmin();
  if (adminErr) return { ok: false, error: adminErr };

  // 専用ハンドラに委譲(実CSVヘッダー対応 / 架電NG分離 / 担当・案件解決 / extra)
  // 例外は握りつぶさず構造化エラーとして返す(クライアントに実メッセージを表示)。
  try {
    if (object === 'members') return await previewMembersCsv([csvText], updateOnly);
    if (object === 'inquiries') return await previewInquiriesCsv([csvText], updateOnly);
    if (object === 'applications') return await previewApplicationsCsv([csvText], updateOnly);
    if (object === 'activities') return await previewActivitiesCsv([csvText], updateOnly);
    if (object === 'article_reactions')
      return await previewArticleReactionsCsv([csvText], updateOnly);
    if (object === 'withdrawal_parents')
      return await previewWithdrawalParentsCsv([csvText], updateOnly);
    if (object === 'withdrawal_children')
      return await previewWithdrawalChildrenCsv([csvText], updateOnly);
    if (object === 'users') return await previewUsersCsv([csvText], updateOnly);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

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
      error: `取込対象の列が見つかりません。テンプレートのヘッダー(${def.fields
        .map((f) => f.label)
        .slice(0, 4)
        .join(' / ')} 等)を使用してください`,
    };
  }

  // 既存行と突合して 新規/更新/スキップ(=変更なし) を判定
  let cls: Classification<(typeof mapped.records)[number]>;
  try {
    const supabase = await createClient();
    cls = await classifyAgainstDb(supabase, def.table, def.idField, mapped.records, (r) => r.id, {
      updateOnly,
      getData: (r) => r.data,
    });
  } catch (e) {
    return {
      ok: false,
      error: `既存データ照会に失敗: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  const { toUpsert, newCount, updateCount, skippedCount, existingIds } = cls;
  const upsertIds = new Set(toUpsert.map((r) => r.id));
  const sample: PreviewResult['sample'] = [];
  for (const r of mapped.records) {
    const mode: '新規' | '更新' | 'スキップ' = !upsertIds.has(r.id)
      ? 'スキップ'
      : existingIds.has(r.id)
        ? '更新'
        : '新規';
    if (sample.length < 20) sample.push({ row: r.row, id: r.id, mode });
  }

  return {
    ok: true,
    totalRows: mapped.totalRows,
    // 取込対象になる行数(更新のみ時はスキップ分を除く)
    validCount: updateOnly ? updateCount : newCount + updateCount,
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

  // 専用ハンドラに委譲(例外は構造化エラーとして返す)
  try {
    if (object === 'members') return await commitMembersCsv([csvText], updateOnly);
    if (object === 'inquiries') return await commitInquiriesCsv([csvText], updateOnly);
    if (object === 'applications') return await commitApplicationsCsv([csvText], updateOnly);
    if (object === 'activities') return await commitActivitiesCsv([csvText], updateOnly);
    if (object === 'article_reactions')
      return await commitArticleReactionsCsv([csvText], updateOnly);
    if (object === 'withdrawal_parents')
      return await commitWithdrawalParentsCsv([csvText], updateOnly);
    if (object === 'withdrawal_children')
      return await commitWithdrawalChildrenCsv([csvText], updateOnly);
    if (object === 'users') return await commitUsersCsv([csvText], updateOnly);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

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

  // 既存行と突合して 新規/更新/スキップ(=変更なし) を判定。変更なしは upsert しない。
  let cls: Classification<(typeof mapped.records)[number]>;
  try {
    cls = await classifyAgainstDb(supabase, def.table, def.idField, mapped.records, (r) => r.id, {
      updateOnly,
      getData: (r) => r.data,
    });
  } catch (e) {
    return {
      ok: false,
      error: `既存データ照会に失敗: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  const { toUpsert, newCount, updateCount, skippedCount } = cls;

  const rows = toUpsert.map((r) => r.data);
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase.from(def.table).upsert(batch, { onConflict: def.idField });
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
    newCount,
    updateCount,
    skippedCount,
    errorCount: mapped.errors.length,
    errors: mapped.errors.slice(0, 50),
  };
}
