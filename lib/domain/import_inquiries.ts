'use server';

/**
 * 問合せ(inquiries)専用 取込 Server Actions (#1/#2 共通 / admin 限定 / CLAUDE.md §5.3, §6)
 *
 * - 2つのフォーム由来CSV(KAWARA版 / 機密保持・CP)を1テーブルに統合
 * - 共通列→カラム、それ以外→extra(JSONB)
 * - フォーム名→form_id は forms を「非破壊」で名前解決(無ければ新規追加のみ)
 * - 会員ID は既存のもののみ採用(FK安全)、問合せID(TA-)で upsert
 *
 * 行変換は lib/import/inquiries.ts(純粋関数)を使用。
 */

import { revalidatePath } from 'next/cache';
import {
  convertInquiryRow,
  INQUIRY_COMMON_KEYS,
  type InquiryRecord,
} from '@/lib/import/inquiries';
import { parseCsv, type RowError } from '@/lib/import/parse';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from './auth';
import type { CommitResult, PreviewResult } from './import_actions';

const BATCH = 500;
const MAX_ROWS = 30_000;

async function assertAdmin(): Promise<string | null> {
  const me = await getCurrentUser();
  if (me.role !== 'admin') return 'データ取込は admin のみ可能です';
  return null;
}

/** 複数CSVテキストをまとめてパース */
function parseAll(csvTexts: string[]): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = [];
  for (const t of csvTexts) {
    if (t && t.trim() !== '') rows.push(...parseCsv(t));
  }
  return rows;
}

// biome-ignore lint/suspicious/noExplicitAny: Tables 型が空のため supabase クライアントは緩い型
type Db = any;

async function loadFormMap(supabase: Db): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const { data } = await supabase.from('forms').select('id,name');
  for (const f of (data ?? []) as Array<{ id: number; name: string | null }>) {
    if (f.name != null) map.set(String(f.name), Number(f.id));
  }
  return map;
}

async function loadValidMemberIds(
  supabase: Db,
  ids: string[],
): Promise<Set<string>> {
  const set = new Set<string>();
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    if (chunk.length === 0) continue;
    const { data } = await supabase.from('members').select('id').in('id', chunk);
    for (const r of (data ?? []) as Array<{ id: string }>) {
      if (r.id != null) set.add(String(r.id));
    }
  }
  return set;
}

function distinctMemberIds(rawRows: Array<Record<string, string>>): string[] {
  const s = new Set<string>();
  for (const r of rawRows) {
    const v = (r['会員ID'] ?? '').trim();
    if (/^K-\d{3,}$/.test(v)) s.add(v);
  }
  return [...s];
}

function distinctFormNames(rawRows: Array<Record<string, string>>): string[] {
  const s = new Set<string>();
  for (const r of rawRows) {
    const v = (r['フォーム名'] ?? '').trim();
    if (v !== '') s.add(v);
  }
  return [...s];
}

/** 共通: 行変換 → 重複排除(問合せID後勝ち) */
function convertAll(
  rawRows: Array<Record<string, string>>,
  formNameToId: Map<string, number>,
  validMemberIds: Set<string>,
): { records: InquiryRecord[]; errors: RowError[] } {
  const errors: RowError[] = [];
  const byId = new Map<string, InquiryRecord>();
  rawRows.forEach((raw, i) => {
    const out = convertInquiryRow(raw, i + 1, { formNameToId, validMemberIds });
    if (out.error) {
      errors.push({ row: i + 1, message: out.error });
      return;
    }
    if (out.record) byId.set(out.record.id, out.record);
  });
  return { records: [...byId.values()], errors };
}

export async function previewInquiriesCsv(
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
  const formMap = await loadFormMap(supabase);
  const validMembers = await loadValidMemberIds(supabase, distinctMemberIds(rawRows));
  const { records, errors } = convertAll(rawRows, formMap, validMembers);

  // 新規 / 更新 判定(既存 inquiries.id を問合せ)
  const ids = records.map((r) => r.id);
  const existing = new Set<string>();
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    if (chunk.length === 0) continue;
    const { data } = await supabase.from('inquiries').select('id').in('id', chunk);
    for (const r of (data ?? []) as Array<{ id: string }>) existing.add(String(r.id));
  }
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

  // 取込されるフォーム名のうち、未登録(新規作成予定)を数える
  const newForms = distinctFormNames(rawRows).filter((n) => !formMap.has(n));
  const headers = rawRows[0] ? Object.keys(rawRows[0]) : [];
  const commonPresent = headers.filter((h) => INQUIRY_COMMON_KEYS.has(h));

  return {
    ok: true,
    totalRows: rawRows.length,
    validCount: updateOnly ? updateCount : records.length,
    newCount,
    updateCount,
    skippedCount,
    errorCount: errors.length,
    errors: errors.slice(0, 50),
    targetLabels: [
      ...commonPresent,
      'ほかフォーム固有項目→extra',
      ...(newForms.length > 0 ? [`新規フォーム${newForms.length}種を追加`] : []),
    ],
    ignoredHeaders: [],
    sample,
  };
}

export async function commitInquiriesCsv(
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

  // 1) forms を非破壊で補完(未登録のフォーム名のみ追加) → 再解決
  let formMap = await loadFormMap(supabase);
  const newForms = distinctFormNames(rawRows).filter((n) => !formMap.has(n));
  if (newForms.length > 0) {
    const { error: fErr } = await supabase
      .from('forms')
      .upsert(
        newForms.map((name) => ({ name, is_active: true })),
        { onConflict: 'name', ignoreDuplicates: true },
      );
    if (fErr) return { ok: false, error: `フォーム追加に失敗: ${fErr.message}` };
    formMap = await loadFormMap(supabase);
  }

  // 2) member 検証 → 行変換
  const validMembers = await loadValidMemberIds(supabase, distinctMemberIds(rawRows));
  const { records, errors } = convertAll(rawRows, formMap, validMembers);
  if (records.length === 0) {
    return {
      ok: false,
      error: '取込可能な有効行がありません',
      errorCount: errors.length,
      errors: errors.slice(0, 50),
    };
  }

  // 更新のみモード: 既存の問合せIDだけに絞る(新規IDはスキップ)
  let targetRecords = records;
  let skippedCount = 0;
  if (updateOnly) {
    const ids = records.map((r) => r.id);
    const existing = new Set<string>();
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH);
      if (chunk.length === 0) continue;
      const { data } = await supabase.from('inquiries').select('id').in('id', chunk);
      for (const r of (data ?? []) as Array<{ id: string }>) existing.add(String(r.id));
    }
    const before = targetRecords.length;
    targetRecords = targetRecords.filter((r) => existing.has(r.id));
    skippedCount = before - targetRecords.length;
  }

  // 3) inquiries upsert(問合せIDで突合)
  let upserted = 0;
  for (let i = 0; i < targetRecords.length; i += BATCH) {
    const batch = targetRecords.slice(i, i + BATCH);
    const { error } = await supabase
      .from('inquiries')
      .upsert(batch, { onConflict: 'id' });
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

  revalidatePath('/inquiries');
  return {
    ok: true,
    upserted,
    skippedCount,
    errorCount: errors.length,
    errors: errors.slice(0, 50),
  };
}
