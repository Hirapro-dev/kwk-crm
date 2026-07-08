'use server';

/**
 * 記事反応リスト(article_reactions)専用 取込 Server Actions
 * (定期取込 #1 / 突発アップロード #2 共通 / admin 限定 / CLAUDE.md §5.13相当, §6)
 *
 * - 反応ID(KH…)で upsert(再取込しても重複しない)
 * - 会員ID(K-)は既存会員にあれば member_id に紐付け、無ければ null(FK安全)
 *   ※「会員氏名（漢字）」→ member_name、「会員氏名」列の旧SF会員ID → member_legacy_sf_id は常に保持
 * - 値の型変換は coerce.ts を使用(日付など)
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
const DEF = IMPORT_OBJECTS.article_reactions as ImportObjectDef;

// biome-ignore lint/suspicious/noExplicitAny: Tables 型が空のため supabase クライアントは緩い型
type Db = any;
type ReactionRecord = Record<string, string | number | boolean | null>;

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

/** CSV 内に現れる会員ID(K-形式)の一覧 */
function distinctMemberIds(rawRows: Array<Record<string, string>>): string[] {
  const s = new Set<string>();
  for (const r of rawRows) {
    const v = (r.会員ID ?? '').trim();
    if (/^K-\d{3,}$/.test(v)) s.add(v);
  }
  return [...s];
}

/** members に実在する会員IDだけを集合で返す(FK安全のため) */
async function loadValidMemberIds(supabase: Db, ids: string[]): Promise<Set<string>> {
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

/** 1行を DBレコードへ変換。id 必須、会員IDは実在チェックして紐付け。 */
function convertRow(
  raw: Record<string, string>,
  validMemberIds: Set<string>,
): { record?: ReactionRecord; error?: string } {
  const rec: ReactionRecord = {};
  for (const f of DEF.fields) {
    const rawVal = (raw[f.label] ?? '').toString();
    const res = coerceValue(f.type, rawVal);
    if (isCoerceErr(res)) return { error: `${f.label}: ${res.error}` };
    rec[f.field] = res.value;
  }
  const id = (rec.id ?? '').toString().trim();
  if (id === '') return { error: 'ID が空です' };
  rec.id = id;

  // 会員ID: 実在する会員のみ紐付け、無ければ null(氏名・旧SF IDは保持済み)
  const mid = (rec.member_id ?? '').toString().trim();
  rec.member_id = mid !== '' && validMemberIds.has(mid) ? mid : null;
  return { record: rec };
}

/** 全行変換 → 反応ID後勝ちで重複排除 */
function convertAll(
  rawRows: Array<Record<string, string>>,
  validMemberIds: Set<string>,
): { records: ReactionRecord[]; errors: RowError[] } {
  const errors: RowError[] = [];
  const byId = new Map<string, ReactionRecord>();
  rawRows.forEach((raw, i) => {
    const out = convertRow(raw, validMemberIds);
    if (out.error) {
      errors.push({ row: i + 1, message: out.error });
      return;
    }
    if (out.record) byId.set(String(out.record.id), out.record);
  });
  return { records: [...byId.values()], errors };
}

export async function previewArticleReactionsCsv(
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
  const validMembers = await loadValidMemberIds(supabase, distinctMemberIds(rawRows));
  const { records, errors } = convertAll(rawRows, validMembers);

  // 既存行と突合して 新規/更新/スキップ(=変更なし) を判定
  const { toUpsert, newCount, updateCount, skippedCount, existingIds } = await classifyAgainstDb(
    supabase,
    'article_reactions',
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
  const present = DEF.fields.filter((f) => headers.includes(f.label)).map((f) => f.label);

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

export async function commitArticleReactionsCsv(
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
  const validMembers = await loadValidMemberIds(supabase, distinctMemberIds(rawRows));
  const { records, errors } = convertAll(rawRows, validMembers);
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
    'article_reactions',
    'id',
    records,
    (r) => String(r.id),
    { updateOnly },
  );

  let upserted = 0;
  for (let i = 0; i < toUpsert.length; i += BATCH) {
    const batch = toUpsert.slice(i, i + BATCH);
    const { error } = await supabase.from('article_reactions').upsert(batch, { onConflict: 'id' });
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

  revalidatePath('/article-reactions');
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
