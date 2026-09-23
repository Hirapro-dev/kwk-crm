'use server';

/**
 * 記事反応リスト: クリック履歴 CSV の取込 Server Actions(admin 限定。CLAUDE.md §5.13b。migration 117)
 *
 * - 配信ツールの「クリック履歴」CSV(クリック日時 / 読者メールアドレス / 読者名前)を 1 人(メール)1 件にまとめる
 *   (判断は純粋関数 dedupeClickRows)。取込時に画面で指定した記事名(詳細と備考の両方に入れる)と配信媒体を入れる。
 * - 同じメール + 同じ備考が既にあれば作らない(スキップ)。再取込しても増えない(DB 側も部分ユニーク)。
 * - Salesforce 形式で既に入っている同じ記事(詳細 = 記事名)・同じ日付の反応で、会員のメール または 会員氏名 が一致する行も
 *   「同じ反応」として作らず、その既存行にメール(と備考 = 記事名)を書き込む(空のときだけ。純粋関数 matchLegacyReactions。2026-09-23)。
 * - ID は DB の DEFAULT(gen_article_reaction_id())に任せる。
 * - 会員照合: メールアドレスが会員の email1〜3 と完全一致(小文字化)し 1 人に絞れた行は、取込時に会員ID・会員氏名を入れる
 *   (プレビューで「会員一致」件数を出す。2026-09-23)。複数候補・該当なしは紐付けず、後から一覧の「会員を検索」でやり直せる。
 * - 取込はサービスロールで実行(RLS の書込は admin のみのため。監査ログの対象外テーブル)。
 */

import {
  CLICK_CSV_COLUMNS,
  type DedupedClick,
  type EmailMatchResult,
  type LegacyMatch,
  type LegacyReactionRow,
  dedupeClickRows,
  matchLegacyReactions,
  matchReactionsByEmail,
} from '@/lib/domain/article_reaction_clicks';
import { loadMembersByEmails } from '@/lib/domain/article_reaction_match_db';
import { parseCsvRaw } from '@/lib/import/parse';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { getCurrentUser } from './auth';
import type { CommitResult, PreviewResult } from './import_actions';

const BATCH = 500;
const MAX_ROWS = 100_000;
const MAX_REMARKS = 200;
const MAX_MEDIA = 100;

/** 取込時に画面で指定する値 */
export interface ClickImportOptions {
  /** 備考(記事名)。必須 */
  remarks: string;
  /** 配信媒体(任意) */
  media?: string | null;
  /** 日付(YYYY-MM-DD。任意)。指定すると全行の reacted_date(一覧の「日付」)をこの日にする。空ならクリック日(日本時間) */
  reactedDate?: string | null;
}

// biome-ignore lint/suspicious/noExplicitAny: Tables 型が空のため supabase クライアントは緩い型
type Db = any;

async function assertAdmin(): Promise<string | null> {
  const me = await getCurrentUser();
  if (me.role !== 'admin') return 'データ取込は admin のみ可能です';
  return null;
}

function normalizeOptions(
  options: ClickImportOptions | undefined,
): { remarks: string; media: string | null; reactedDate: string | null } | { error: string } {
  const remarks = (options?.remarks ?? '').trim();
  if (remarks === '') return { error: '記事名を入力してください' };
  if (remarks.length > MAX_REMARKS)
    return { error: `備考は ${MAX_REMARKS} 文字以内にしてください` };
  const media = (options?.media ?? '').trim();
  if (media.length > MAX_MEDIA) return { error: `配信媒体は ${MAX_MEDIA} 文字以内にしてください` };
  const reactedDate = (options?.reactedDate ?? '').trim();
  if (reactedDate !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(reactedDate)) {
    return { error: '日付は YYYY-MM-DD 形式で指定してください' };
  }
  if (reactedDate !== '' && Number.isNaN(new Date(`${reactedDate}T00:00:00+09:00`).getTime())) {
    return { error: '日付を解釈できません' };
  }
  return {
    remarks,
    media: media === '' ? null : media,
    reactedDate: reactedDate === '' ? null : reactedDate,
  };
}

/** CSV を解析して 1 人 1 件にまとめる。列が無ければエラー */
function parseAndDedupe(
  csvTexts: string[],
):
  | { ok: true; totalRows: number; result: ReturnType<typeof dedupeClickRows> }
  | { ok: false; error: string } {
  const rawRows: Array<Record<string, string>> = [];
  try {
    for (const t of csvTexts) {
      // 日時を整形せずそのまま読む(parseCsv は時刻を落とす)
      if (t && t.trim() !== '') rawRows.push(...parseCsvRaw(t));
    }
  } catch (e) {
    return { ok: false, error: `CSV解析に失敗: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (rawRows.length === 0) return { ok: false, error: 'データ行がありません' };
  if (rawRows.length > MAX_ROWS) {
    return { ok: false, error: `行数が上限(${MAX_ROWS.toLocaleString()})を超えています` };
  }
  const headers = Object.keys(rawRows[0] ?? {});
  const missing = [CLICK_CSV_COLUMNS.clickedAt, CLICK_CSV_COLUMNS.email].filter(
    (h) => !headers.includes(h),
  );
  if (missing.length > 0) {
    return { ok: false, error: `CSV に必要な列がありません: ${missing.join(' / ')}` };
  }
  const result = dedupeClickRows(
    rawRows.map((r) => ({
      clickedAt: r[CLICK_CSV_COLUMNS.clickedAt] ?? '',
      email: r[CLICK_CSV_COLUMNS.email] ?? '',
      name: r[CLICK_CSV_COLUMNS.name] ?? '',
    })),
  );
  return { ok: true, totalRows: rawRows.length, result };
}

/** 同じ備考で既に登録済みのメールアドレスの集合 */
async function loadExistingEmails(
  supabase: Db,
  remarks: string,
  emails: string[],
): Promise<Set<string>> {
  const set = new Set<string>();
  for (let i = 0; i < emails.length; i += BATCH) {
    const chunk = emails.slice(i, i + BATCH);
    if (chunk.length === 0) continue;
    const { data, error } = await supabase
      .from('article_reactions')
      .select('email')
      .eq('remarks', remarks)
      .is('deleted_at', null)
      .in('email', chunk);
    if (error) throw new Error(`既存データの確認に失敗: ${error.message}`);
    for (const r of (data ?? []) as Array<{ email: string | null }>) {
      if (r.email) set.add(r.email);
    }
  }
  return set;
}

/** メール(小文字)→ 1 人に絞れた会員 */
type LinkMap = Map<string, { memberId: string; memberName: string | null }>;

/** 取り込む行の会員照合(メール完全一致)。行の id はメールで代用する */
async function matchForImport(
  supabase: Db,
  rows: DedupedClick[],
): Promise<{ result: EmailMatchResult; links: LinkMap }> {
  const members = await loadMembersByEmails(
    supabase,
    rows.map((r) => r.email),
  );
  const result = matchReactionsByEmail(
    rows.map((r) => ({ id: r.email, email: r.email })),
    members,
  );
  const links: LinkMap = new Map();
  for (const l of result.linked)
    links.set(l.id, { memberId: l.memberId, memberName: l.memberName });
  return { result, links };
}

/** 同じ記事名(詳細)の Salesforce 形式の行(メール列なし)と突き合わせる。既存行の ID → 会員のメール一覧も読む */
async function matchLegacyForImport(
  supabase: Db,
  rows: DedupedClick[],
  remarks: string,
  reactedDate: string | null,
): Promise<LegacyMatch[]> {
  if (rows.length === 0) return [];
  const { data, error } = await supabase
    .from('article_reactions')
    .select('id, member_id, member_name, reacted_date')
    .eq('detail', remarks)
    .is('email', null)
    .is('deleted_at', null)
    .limit(5000);
  if (error) throw new Error(`既存の記事反応の確認に失敗: ${error.message}`);
  const legacy = (data ?? []) as LegacyReactionRow[];
  if (legacy.length === 0) return [];
  const memberIds = [...new Set(legacy.map((l) => l.member_id).filter((v): v is string => !!v))];
  const memberEmails = new Map<string, string[]>();
  for (let i = 0; i < memberIds.length; i += BATCH) {
    const chunk = memberIds.slice(i, i + BATCH);
    const { data: ms, error: mErr } = await supabase
      .from('members')
      .select('id, email1, email2, email3')
      .in('id', chunk);
    if (mErr) throw new Error(`会員の確認に失敗: ${mErr.message}`);
    for (const m of (ms ?? []) as Array<{
      id: string;
      email1: string | null;
      email2: string | null;
      email3: string | null;
    }>) {
      memberEmails.set(
        m.id,
        [m.email1, m.email2, m.email3].map((e) => (e ?? '').trim().toLowerCase()).filter(Boolean),
      );
    }
  }
  return matchLegacyReactions(rows, legacy, memberEmails, (r) => reactedDate ?? r.registeredDate);
}

function toRecord(
  row: DedupedClick,
  remarks: string,
  media: string | null,
  reactedDate: string | null,
  link: { memberId: string; memberName: string | null } | undefined,
) {
  return {
    email: row.email,
    // 会員に紐付いた行は CRM の会員氏名を優先(CSV の読者名前はほとんど空)
    member_name: link ? (link.memberName ?? row.name) : row.name,
    member_id: link?.memberId ?? null,
    registered_at: row.registeredAt,
    // 日付は画面で指定した日を優先。無ければいちばん早いクリックの日(日本時間)
    reacted_date: reactedDate ?? row.registeredDate,
    // 記事名は「詳細」(Salesforce 形式の取込で記事名が入っていた列)にも入れ、レポート・一覧の見た目を揃える(2026-09-23)。
    // 「備考」は同じメール + 同じ記事名の重複防止キーとして残す
    detail: remarks,
    remarks,
    media,
    tool: 'メルマガ',
    reaction_type: 'クリック',
  };
}

export async function previewArticleReactionClicksCsv(
  csvTexts: string[],
  options?: ClickImportOptions,
): Promise<PreviewResult> {
  const adminErr = await assertAdmin();
  if (adminErr) return { ok: false, error: adminErr };
  const opt = normalizeOptions(options);
  if ('error' in opt) return { ok: false, error: opt.error };

  const parsed = parseAndDedupe(csvTexts);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const { rows, errors } = parsed.result;

  const supabase = createServiceRoleClient();
  const existing = await loadExistingEmails(
    supabase,
    opt.remarks,
    rows.map((r) => r.email),
  );
  const candidates = rows.filter((r) => !existing.has(r.email));
  let legacyMatches: LegacyMatch[];
  let match: Awaited<ReturnType<typeof matchForImport>>;
  try {
    legacyMatches = await matchLegacyForImport(supabase, candidates, opt.remarks, opt.reactedDate);
    const legacyEmails = new Set(legacyMatches.map((m) => m.email));
    match = await matchForImport(
      supabase,
      candidates.filter((r) => !legacyEmails.has(r.email)),
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const legacyByEmail = new Map(legacyMatches.map((m) => [m.email, m]));
  const newRows = candidates.filter((r) => !legacyByEmail.has(r.email));
  const sample: PreviewResult['sample'] = rows.slice(0, 20).map((r, i) => {
    const link = match.links.get(r.email);
    const legacy = legacyByEmail.get(r.email);
    return {
      row: i + 1,
      id: r.email,
      mode: existing.has(r.email) || legacy ? 'スキップ' : '新規',
      note: legacy
        ? `既存 ${legacy.existingId}(${legacy.by === 'email' ? 'メール' : '氏名'}一致)`
        : link
          ? `${link.memberId} ${link.memberName ?? ''}`.trim()
          : undefined,
    };
  });

  return {
    ok: true,
    totalRows: parsed.totalRows,
    validCount: newRows.length,
    newCount: newRows.length,
    updateCount: 0,
    skippedCount: existing.size,
    legacyMatchedCount: legacyMatches.length,
    matchedCount: match.result.linked.length,
    multipleCount: match.result.multiple.length,
    errorCount: errors.length,
    errors: errors.slice(0, 50),
    targetLabels: [
      CLICK_CSV_COLUMNS.clickedAt,
      CLICK_CSV_COLUMNS.email,
      CLICK_CSV_COLUMNS.name,
      `備考=${opt.remarks}`,
      `配信媒体=${opt.media ?? '(なし)'}`,
      `日付=${opt.reactedDate ?? 'クリック日'}`,
    ],
    ignoredHeaders: [],
    sample,
  };
}

export async function commitArticleReactionClicksCsv(
  csvTexts: string[],
  options?: ClickImportOptions,
): Promise<CommitResult> {
  const adminErr = await assertAdmin();
  if (adminErr) return { ok: false, error: adminErr };
  const opt = normalizeOptions(options);
  if ('error' in opt) return { ok: false, error: opt.error };

  const parsed = parseAndDedupe(csvTexts);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const { rows, errors } = parsed.result;

  const supabase = createServiceRoleClient();
  const existing = await loadExistingEmails(
    supabase,
    opt.remarks,
    rows.map((r) => r.email),
  );
  const candidates = rows.filter((r) => !existing.has(r.email));
  let legacyMatches: LegacyMatch[];
  let match: Awaited<ReturnType<typeof matchForImport>>;
  try {
    legacyMatches = await matchLegacyForImport(supabase, candidates, opt.remarks, opt.reactedDate);
    const legacyEmails = new Set(legacyMatches.map((m) => m.email));
    match = await matchForImport(
      supabase,
      candidates.filter((r) => !legacyEmails.has(r.email)),
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const legacyEmailSet = new Set(legacyMatches.map((m) => m.email));
  const newRows = candidates.filter((r) => !legacyEmailSet.has(r.email));
  const records = newRows.map((r) =>
    toRecord(r, opt.remarks, opt.media, opt.reactedDate, match.links.get(r.email)),
  );

  // Salesforce 形式の既存行に一致した分: 新しい行は作らず、既存行にメールと備考(記事名)を書き込む(空のときだけ。
  // 同じ既存行に複数のクリック行が当たったときは最初の 1 件だけ)
  const seenLegacy = new Set<string>();
  for (const m of legacyMatches) {
    if (seenLegacy.has(m.existingId)) continue;
    seenLegacy.add(m.existingId);
    const { error } = await supabase
      .from('article_reactions')
      .update({ email: m.email, remarks: opt.remarks })
      .eq('id', m.existingId)
      .is('email', null);
    if (error) {
      return {
        ok: false,
        error: `既存行へのメール書込みに失敗(${m.existingId}): ${error.message}`,
      };
    }
  }

  if (records.length === 0) {
    return {
      ok: false,
      error:
        existing.size + legacyMatches.length > 0
          ? `すべて登録済みです(同じ記事名「${opt.remarks}」で ${existing.size} 件、Salesforce 取込分との一致 ${legacyMatches.length} 件)`
          : '取込可能な有効行がありません',
      errorCount: errors.length,
      errors: errors.slice(0, 50),
      skippedCount: existing.size,
      legacyMatchedCount: legacyMatches.length,
    };
  }

  let inserted = 0;
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    const { error } = await supabase.from('article_reactions').insert(batch);
    if (error) {
      return {
        ok: false,
        error: `${i + 1}〜${i + batch.length}件目の保存に失敗: ${error.message}`,
        upserted: inserted,
        skippedCount: existing.size,
      };
    }
    inserted += batch.length;
  }

  revalidatePath('/article-reactions');
  return {
    ok: true,
    upserted: inserted,
    newCount: inserted,
    updateCount: 0,
    skippedCount: existing.size,
    legacyMatchedCount: legacyMatches.length,
    matchedCount: match.result.linked.length,
    errorCount: errors.length,
    errors: errors.slice(0, 50),
  };
}
