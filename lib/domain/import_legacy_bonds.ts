'use server';

/**
 * 旧社債管理(legacy_bonds)専用 取込 Server Actions(admin 限定。CLAUDE.md §5.13c。migration 118)
 *
 * - 旧社債管理ID(KS-)で upsert(再取込しても重複しない)
 * - 会員ID(K-)・申込ID(M-)は実在チェックして紐付け(無ければ null。申込の原文は application_no に保持)
 * - 案件は案件マスタの名前で解決(原文は project_name に保持)
 * - 行の変換は純粋関数 convertLegacyBondRow。CSV は値を整形せずに読む(parseCsvRaw。償還対象月 "2025/08" を日付に化けさせない)
 * - 取込はサービスロールで実行(RLS の書込は admin のみのため)
 */

import { classifyAgainstDb } from '@/lib/import/diff';
import { type RowError, parseCsvRaw } from '@/lib/import/parse';
import { IMPORT_OBJECTS, type ImportObjectDef } from '@/lib/import/schema';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { getCurrentUser } from './auth';
import type { CommitResult, PreviewResult } from './import_actions';
import {
  type LegacyBondLinkContext,
  type LegacyBondRecord,
  convertLegacyBondRow,
} from './legacy_bonds_pure';

const BATCH = 500;
const MAX_ROWS = 100_000;
const DEF = IMPORT_OBJECTS.legacy_bonds as ImportObjectDef;

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
    if (t && t.trim() !== '') rows.push(...parseCsvRaw(t));
  }
  return rows;
}

function distinctValues(rawRows: Array<Record<string, string>>, header: string): string[] {
  const s = new Set<string>();
  for (const r of rawRows) {
    const v = (r[header] ?? '').trim();
    if (v) s.add(v);
  }
  return [...s];
}

async function loadValidIds(supabase: Db, table: string, ids: string[]): Promise<Set<string>> {
  const set = new Set<string>();
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    if (chunk.length === 0) continue;
    const { data, error } = await supabase.from(table).select('id').in('id', chunk);
    if (error) throw new Error(`${table} の確認に失敗: ${error.message}`);
    for (const r of (data ?? []) as Array<{ id: string }>) set.add(String(r.id));
  }
  return set;
}

async function loadProjectIdsByName(supabase: Db, names: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let i = 0; i < names.length; i += BATCH) {
    const chunk = names.slice(i, i + BATCH);
    if (chunk.length === 0) continue;
    const { data, error } = await supabase.from('projects').select('id, name').in('name', chunk);
    if (error) throw new Error(`案件マスタの確認に失敗: ${error.message}`);
    for (const r of (data ?? []) as Array<{ id: string; name: string }>)
      map.set(r.name.trim(), r.id);
  }
  return map;
}

async function buildContext(
  supabase: Db,
  rawRows: Array<Record<string, string>>,
): Promise<LegacyBondLinkContext> {
  const [validMemberIds, validApplicationIds, projectIdByName] = await Promise.all([
    loadValidIds(supabase, 'members', distinctValues(rawRows, '会員ID')),
    loadValidIds(supabase, 'applications', distinctValues(rawRows, '申込ID')),
    loadProjectIdsByName(supabase, distinctValues(rawRows, '案件')),
  ]);
  return { validMemberIds, validApplicationIds, projectIdByName };
}

/** 全行変換 → ID 後勝ちで重複排除 */
function convertAll(
  rawRows: Array<Record<string, string>>,
  ctx: LegacyBondLinkContext,
): { records: LegacyBondRecord[]; errors: RowError[] } {
  const errors: RowError[] = [];
  const byId = new Map<string, LegacyBondRecord>();
  rawRows.forEach((raw, i) => {
    const out = convertLegacyBondRow(raw, DEF.fields, ctx);
    if (out.error) {
      errors.push({ row: i + 1, message: out.error });
      return;
    }
    if (out.record) byId.set(String(out.record.id), out.record);
  });
  return { records: [...byId.values()], errors };
}

function validate(
  csvTexts: string[],
): { ok: true; rawRows: Array<Record<string, string>> } | { ok: false; error: string } {
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
  const headers = Object.keys(rawRows[0] ?? {});
  if (!headers.includes('旧社債管理ID')) {
    return {
      ok: false,
      error: 'CSV に「旧社債管理ID」列がありません(旧社債管理一覧の書き出しを使ってください)',
    };
  }
  return { ok: true, rawRows };
}

export async function previewLegacyBondsCsv(
  csvTexts: string[],
  updateOnly = false,
): Promise<PreviewResult> {
  const adminErr = await assertAdmin();
  if (adminErr) return { ok: false, error: adminErr };
  const v = validate(csvTexts);
  if (!v.ok) return { ok: false, error: v.error };
  const { rawRows } = v;

  const supabase = createServiceRoleClient();
  let ctx: LegacyBondLinkContext;
  try {
    ctx = await buildContext(supabase, rawRows);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const { records, errors } = convertAll(rawRows, ctx);
  const { toUpsert, newCount, updateCount, skippedCount, existingIds } = await classifyAgainstDb(
    supabase,
    'legacy_bonds',
    'id',
    records,
    (r) => String(r.id),
    { updateOnly },
  );
  const upsertIds = new Set(toUpsert.map((r) => String(r.id)));
  const sample: PreviewResult['sample'] = records.slice(0, 20).map((r, i) => {
    const id = String(r.id);
    const notes = [
      r.member_id ? `会員 ${r.member_id}` : '会員なし',
      r.application_id ? `申込 ${r.application_id}` : '申込なし',
      r.project_id ? '案件あり' : '案件なし',
    ];
    return {
      row: i + 1,
      id,
      mode: !upsertIds.has(id) ? 'スキップ' : existingIds.has(id) ? '更新' : '新規',
      note: notes.join(' / '),
    };
  });
  const headers = Object.keys(rawRows[0] ?? {});
  const present = DEF.fields.filter((f) => headers.includes(f.label)).map((f) => f.label);
  const ignored = headers.filter((h) => h && !DEF.fields.some((f) => f.label === h));

  return {
    ok: true,
    totalRows: rawRows.length,
    validCount: updateOnly ? updateCount : newCount + updateCount,
    newCount,
    updateCount,
    skippedCount,
    errorCount: errors.length,
    errors: errors.slice(0, 50),
    targetLabels: present,
    ignoredHeaders: ignored,
    sample,
  };
}

export async function commitLegacyBondsCsv(
  csvTexts: string[],
  updateOnly = false,
): Promise<CommitResult> {
  const adminErr = await assertAdmin();
  if (adminErr) return { ok: false, error: adminErr };
  const v = validate(csvTexts);
  if (!v.ok) return { ok: false, error: v.error };
  const { rawRows } = v;

  const supabase = createServiceRoleClient();
  let ctx: LegacyBondLinkContext;
  try {
    ctx = await buildContext(supabase, rawRows);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const { records, errors } = convertAll(rawRows, ctx);
  if (records.length === 0) {
    return {
      ok: false,
      error: '取込可能な有効行がありません',
      errorCount: errors.length,
      errors: errors.slice(0, 50),
    };
  }
  const { toUpsert, newCount, updateCount, skippedCount } = await classifyAgainstDb(
    supabase,
    'legacy_bonds',
    'id',
    records,
    (r) => String(r.id),
    { updateOnly },
  );

  let upserted = 0;
  for (let i = 0; i < toUpsert.length; i += BATCH) {
    const batch = toUpsert.slice(i, i + BATCH);
    const { error } = await supabase.from('legacy_bonds').upsert(batch, { onConflict: 'id' });
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

  revalidatePath('/legacy-bonds');
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
