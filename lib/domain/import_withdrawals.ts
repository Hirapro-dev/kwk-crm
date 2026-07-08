'use server';

/**
 * 出金管理-親/子 (withdrawal_parents / withdrawal_children) 専用 取込 Server Actions
 * (定期取込 #1 / 突発アップロード #2 共通 / admin 限定 / CLAUDE.md §5.13, §6)
 *
 * - 償還-親No(SO-) / 償還-子No(SC-) で upsert(再取込しても重複しない)
 * - 会員ID(K-)は既存会員にあれば member_id に紐付け、無ければ null(FK安全)
 * - 子の償還-親No は原文を parent_no に保持し、withdrawal_parents に実在すれば
 *   parent_id に紐付け(無ければ null)。親を先に取り込むこと。
 * - 既存行と完全一致の行はスキップ(新規/更新/スキップ区分。lib/import/diff.ts)
 *
 * 取込はサービスロールで実行(auth.uid()=null → 監査ログに取込を記録しない / §5.12)。
 */

import { coerceValue, isCoerceErr } from '@/lib/import/coerce';
import { classifyAgainstDb } from '@/lib/import/diff';
import { type RowError, parseCsv } from '@/lib/import/parse';
import { IMPORT_OBJECTS, type ImportObjectDef } from '@/lib/import/schema';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { getCurrentUser } from './auth';
import type { CommitResult, PreviewResult } from './import_actions';

const BATCH = 500;
const MAX_ROWS = 100_000;

// biome-ignore lint/suspicious/noExplicitAny: Tables 型が空のため supabase クライアントは緩い型
type Db = any;
type WithdrawalRecord = Record<string, string | number | boolean | null>;

async function assertAdmin(): Promise<string | null> {
  const me = await getCurrentUser();
  if (me.role !== 'admin') return 'データ取込は admin のみ可能です';
  return null;
}

/**
 * ヘッダー行より前のゴミ行(合計金額行など)を取り除く。
 * 元CSVはヘッダーの上に集計行があるため、ID列ラベル(償還-親No/償還-子No)を含む
 * 最初の行をヘッダーとみなし、それ以降だけをパースする。
 * 見つからない場合は原文のまま返す(従来の取込用CSVは1行目がヘッダー)。
 */
function sliceFromHeaderLine(text: string, idLabel: string): string {
  const lines = text.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.includes(idLabel));
  if (idx <= 0) return text;
  return lines.slice(idx).join('\n');
}

function parseAll(csvTexts: string[], idLabel: string): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = [];
  for (const t of csvTexts) {
    if (t && t.trim() !== '') rows.push(...parseCsv(sliceFromHeaderLine(t, idLabel)));
  }
  return rows;
}

/**
 * ヘッダーの表記ゆれ対応。
 * 子の案件列は 実CSV=「案件」/ 旧・取込用CSV=「投資案件」の2表記がある。
 */
const HEADER_ALIASES: Record<string, string[]> = {
  案件: ['投資案件'],
  投資案件: ['案件'],
};

/** ラベル本命 → 無ければ別名の順で値を取り出す */
function rawValueFor(raw: Record<string, string>, label: string): string {
  if (raw[label] !== undefined) return (raw[label] ?? '').toString();
  for (const alias of HEADER_ALIASES[label] ?? []) {
    if (raw[alias] !== undefined) return (raw[alias] ?? '').toString();
  }
  return '';
}

/** CSV 内に現れる指定ヘッダーの値(前後trim・非空)の一覧 */
function distinctHeaderValues(rawRows: Array<Record<string, string>>, header: string): string[] {
  const s = new Set<string>();
  for (const r of rawRows) {
    const v = (r[header] ?? '').trim();
    if (v !== '') s.add(v);
  }
  return [...s];
}

/** 指定テーブルに実在する id だけを集合で返す(FK安全のため) */
async function loadValidIds(supabase: Db, table: string, ids: string[]): Promise<Set<string>> {
  const set = new Set<string>();
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    if (chunk.length === 0) continue;
    const { data } = await supabase.from(table).select('id').in('id', chunk);
    for (const r of (data ?? []) as Array<{ id: string }>) {
      if (r.id != null) set.add(String(r.id));
    }
  }
  return set;
}

interface ConvertContext {
  def: ImportObjectDef;
  validMemberIds: Set<string>;
  /** 子のみ: 実在する親ID集合(親は undefined) */
  validParentIds?: Set<string>;
}

/** 1行を DBレコードへ変換。id 必須、会員ID/親No は実在チェックして紐付け。 */
function convertRow(
  raw: Record<string, string>,
  ctx: ConvertContext,
): { record?: WithdrawalRecord; error?: string } {
  const rec: WithdrawalRecord = {};
  for (const f of ctx.def.fields) {
    const rawVal = rawValueFor(raw, f.label);
    const res = coerceValue(f.type, rawVal);
    if (isCoerceErr(res)) return { error: `${f.label}: ${res.error}` };
    rec[f.field] = res.value;
  }
  const id = (rec.id ?? '').toString().trim();
  if (id === '') return { error: `${ctx.def.fields[0]?.label ?? 'ID'} が空です` };
  rec.id = id;

  // 会員ID: 実在する会員のみ紐付け、無ければ null(氏名スナップショットは保持済み)
  const mid = (rec.member_id ?? '').toString().trim();
  rec.member_id = mid !== '' && ctx.validMemberIds.has(mid) ? mid : null;

  // 子のみ: 償還-親No(原文は parent_no に保持済み)→ 実在すれば parent_id に紐付け
  if (ctx.validParentIds) {
    const pno = (rec.parent_no ?? '').toString().trim();
    rec.parent_id = pno !== '' && ctx.validParentIds.has(pno) ? pno : null;
  }
  return { record: rec };
}

/** 全行変換 → ID後勝ちで重複排除 */
function convertAll(
  rawRows: Array<Record<string, string>>,
  ctx: ConvertContext,
): { records: WithdrawalRecord[]; errors: RowError[] } {
  const errors: RowError[] = [];
  const byId = new Map<string, WithdrawalRecord>();
  rawRows.forEach((raw, i) => {
    const out = convertRow(raw, ctx);
    if (out.error) {
      errors.push({ row: i + 1, message: out.error });
      return;
    }
    if (out.record) byId.set(String(out.record.id), out.record);
  });
  return { records: [...byId.values()], errors };
}

/** 親子共通の変換コンテキストを構築する */
async function buildContext(
  supabase: Db,
  object: 'withdrawal_parents' | 'withdrawal_children',
  rawRows: Array<Record<string, string>>,
): Promise<ConvertContext> {
  const def = IMPORT_OBJECTS[object] as ImportObjectDef;
  const validMemberIds = await loadValidIds(
    supabase,
    'members',
    distinctHeaderValues(rawRows, '会員ID'),
  );
  if (object === 'withdrawal_children') {
    const validParentIds = await loadValidIds(
      supabase,
      'withdrawal_parents',
      distinctHeaderValues(rawRows, '償還-親No'),
    );
    return { def, validMemberIds, validParentIds };
  }
  return { def, validMemberIds };
}

/** ヘッダー行検出に使うID列ラベル */
function idLabelFor(object: 'withdrawal_parents' | 'withdrawal_children'): string {
  return object === 'withdrawal_parents' ? '償還-親No' : '償還-子No';
}

async function previewWithdrawals(
  object: 'withdrawal_parents' | 'withdrawal_children',
  csvTexts: string[],
  updateOnly: boolean,
): Promise<PreviewResult> {
  const adminErr = await assertAdmin();
  if (adminErr) return { ok: false, error: adminErr };

  let rawRows: Array<Record<string, string>>;
  try {
    rawRows = parseAll(csvTexts, idLabelFor(object));
  } catch (e) {
    return { ok: false, error: `CSV解析に失敗: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (rawRows.length === 0) return { ok: false, error: 'データ行がありません' };
  if (rawRows.length > MAX_ROWS) {
    return { ok: false, error: `行数が上限(${MAX_ROWS.toLocaleString()})を超えています` };
  }

  const supabase = createServiceRoleClient();
  const ctx = await buildContext(supabase, object, rawRows);
  const { records, errors } = convertAll(rawRows, ctx);

  // 既存行と突合して 新規/更新/スキップ(=変更なし) を判定
  const { toUpsert, newCount, updateCount, skippedCount, existingIds } = await classifyAgainstDb(
    supabase,
    ctx.def.table,
    'id',
    records,
    (r) => String(r.id),
    { updateOnly },
  );
  const upsertIds = new Set(toUpsert.map((r) => String(r.id)));
  const sample: PreviewResult['sample'] = [];
  for (const r of records) {
    const id = String(r.id);
    const mode: '新規' | '更新' | 'スキップ' = !upsertIds.has(id)
      ? 'スキップ'
      : existingIds.has(id)
        ? '更新'
        : '新規';
    if (sample.length < 20) sample.push({ row: 0, id, mode });
  }

  const headers = rawRows[0] ? Object.keys(rawRows[0]) : [];
  const present = ctx.def.fields.filter((f) => headers.includes(f.label)).map((f) => f.label);

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
    ignoredHeaders: [],
    sample,
  };
}

async function commitWithdrawals(
  object: 'withdrawal_parents' | 'withdrawal_children',
  csvTexts: string[],
  updateOnly: boolean,
): Promise<CommitResult> {
  const adminErr = await assertAdmin();
  if (adminErr) return { ok: false, error: adminErr };

  let rawRows: Array<Record<string, string>>;
  try {
    rawRows = parseAll(csvTexts, idLabelFor(object));
  } catch (e) {
    return { ok: false, error: `CSV解析に失敗: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (rawRows.length === 0) return { ok: false, error: 'データ行がありません' };
  if (rawRows.length > MAX_ROWS) {
    return { ok: false, error: `行数が上限(${MAX_ROWS.toLocaleString()})を超えています` };
  }

  const supabase = createServiceRoleClient();
  const ctx = await buildContext(supabase, object, rawRows);
  const { records, errors } = convertAll(rawRows, ctx);
  if (records.length === 0) {
    return {
      ok: false,
      error: '取込可能な有効行がありません',
      errorCount: errors.length,
      errors: errors.slice(0, 50),
    };
  }

  // 既存行と突合して 新規/更新/スキップ(=変更なし) を判定。変更なしは upsert しない。
  const { toUpsert, newCount, updateCount, skippedCount } = await classifyAgainstDb(
    supabase,
    ctx.def.table,
    'id',
    records,
    (r) => String(r.id),
    { updateOnly },
  );

  let upserted = 0;
  for (let i = 0; i < toUpsert.length; i += BATCH) {
    const batch = toUpsert.slice(i, i + BATCH);
    const { error } = await supabase.from(ctx.def.table).upsert(batch, { onConflict: 'id' });
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

  revalidatePath(object === 'withdrawal_parents' ? '/withdrawal-parents' : '/withdrawal-children');
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

export async function previewWithdrawalParentsCsv(
  csvTexts: string[],
  updateOnly = false,
): Promise<PreviewResult> {
  return previewWithdrawals('withdrawal_parents', csvTexts, updateOnly);
}

export async function commitWithdrawalParentsCsv(
  csvTexts: string[],
  updateOnly = false,
): Promise<CommitResult> {
  return commitWithdrawals('withdrawal_parents', csvTexts, updateOnly);
}

export async function previewWithdrawalChildrenCsv(
  csvTexts: string[],
  updateOnly = false,
): Promise<PreviewResult> {
  return previewWithdrawals('withdrawal_children', csvTexts, updateOnly);
}

export async function commitWithdrawalChildrenCsv(
  csvTexts: string[],
  updateOnly = false,
): Promise<CommitResult> {
  return commitWithdrawals('withdrawal_children', csvTexts, updateOnly);
}
