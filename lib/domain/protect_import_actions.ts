'use server';

/**
 * プロテクト設定CSV取り込み Server Actions
 *
 * CSV 形式(顧客情報プロテクト.csv):
 *   Id, Member_ID__c, Name, OwnerId, protect__c
 *
 * protect__c の値:
 *   - 'free'        → スキップ(プロテクトなし)
 *   - '会社プロテクト' → 固定プロテクト(2099年)
 *   - 'ex sales'    → 固定プロテクト(元担当者、現在は非アクティブ扱い)
 *   - ユーザー名     → OwnerId → legacy_sf_id でユーザー逆引き
 *                      非アクティブ or 特定ユーザーなら固定、それ以外は通常プロテクト
 *
 * 入力ソース: Drive ファイルID または クライアントからのCSVテキスト直接
 */

import { extractDriveFileId, fetchDriveFileCsv, isDriveConfigured } from '@/lib/google/drive';
import { calcExpiresAt } from '@/lib/domain/flow_rules_types';
import { listFlowRules } from '@/lib/domain/flow_rules';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from './auth';

// ─────────────────────────────────────────────
// 定数
// ─────────────────────────────────────────────

const PROTECT_OBJECT_KEY = 'protect';

/** 固定プロテクト: 2099年1月1日 JST 00:00 (UTC 2098-12-31 15:00) */
const FIXED_PROTECT_EXPIRES = '2099-01-01T15:00:00.000Z';

/** protect__c がこの値のとき → 固定プロテクト(ユーザー問わず) */
const FIXED_PROTECT_VALUES = new Set(['会社プロテクト']);

/** 固定プロテクトとなるユーザー氏名(完全一致) */
const FIXED_PROTECT_USER_NAMES = new Set(['守田 和之', '守田 和幸', '植田 雄輝']);

/** 情報取得ポイントによる固定プロテクト判定キーワード */
const FIXED_ACQUIRE_KEYWORDS = ['既存顧客の紹介', 'リスト外'];

// ─────────────────────────────────────────────
// 型定義
// ─────────────────────────────────────────────

export interface ProtectImportPreview {
  ok: boolean;
  error?: string;
  totalRows: number;
  fixedCount: number;
  normalCount: number;
  skipCount: number;
  errorCount: number;
  errors: { row: number; message: string }[];
}

export interface ProtectImportResult {
  ok: boolean;
  error?: string;
  updated: number;
  fixedCount: number;
  normalCount: number;
  skipCount: number;
  errorCount: number;
  errors: { memberId: string; message: string }[];
}

export interface ProtectImportSource {
  drive_file_id: string | null;
  enabled: boolean;
  last_run_at: string | null;
  last_run_status: string | null;
  last_run_message: string | null;
}

// ─────────────────────────────────────────────
// ヘルパー
// ─────────────────────────────────────────────

async function assertAdmin(): Promise<string | null> {
  const me = await getCurrentUser();
  if (me.role !== 'admin') return 'プロテクト取込設定は admin のみ可能です';
  return null;
}

interface ParsedRow {
  memberId: string | null;
  ownerSfId: string | null;
  protectValue: string | null;
}

/**
 * CSV の1行から member_id・owner_sf_id・protect__c を抽出する。
 * 対応する CSV 列名例:
 *   Member_ID__c, K-XXX 形式の値 → memberId
 *   OwnerId, owner_id           → ownerSfId
 *   protect__c                  → protectValue
 */
function parseCsvRow(row: Record<string, string>): ParsedRow {
  let memberId: string | null = null;
  let ownerSfId: string | null = null;
  let protectValue: string | null = null;

  for (const k of Object.keys(row)) {
    const v = (row[k] ?? '').trim();
    const kl = k.toLowerCase();

    // 会員ID: 列名に member_id / 会員id が含まれる、または値が K-\d 形式
    if (!memberId) {
      const byKey = kl.includes('member_id') || kl.includes('会員id') || kl.includes('member id');
      const byVal = /^K-\d/.test(v);
      if (byKey || byVal) memberId = v || null;
    }

    // OwnerId: 完全一致か列名に ownerid が含まれる
    if (!ownerSfId && (k === 'OwnerId' || kl.includes('ownerid') || k === 'owner_id')) {
      ownerSfId = v || null;
    }

    // protect__c: 完全一致か列名に protect が含まれる
    if (!protectValue && (k === 'protect__c' || kl.includes('protect'))) {
      protectValue = v || null;
    }
  }

  return { memberId, ownerSfId, protectValue };
}

// ─────────────────────────────────────────────
// 設定の保存・読み込み
// ─────────────────────────────────────────────

export async function saveProtectImportSource(fileId: string): Promise<{ ok: boolean; error?: string }> {
  const adminErr = await assertAdmin();
  if (adminErr) return { ok: false, error: adminErr };

  const cleanFileId = fileId ? extractDriveFileId(fileId) : null;
  const supabase = await createClient();
  const { error } = await supabase.from('import_sources').upsert(
    { object: PROTECT_OBJECT_KEY, drive_file_id: cleanFileId, enabled: !!cleanFileId },
    { onConflict: 'object' },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function getProtectImportSource(): Promise<ProtectImportSource> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from('import_sources')
      .select('drive_file_id, enabled, last_run_at, last_run_status, last_run_message')
      .eq('object', PROTECT_OBJECT_KEY)
      .maybeSingle();
    if (!data) return { drive_file_id: null, enabled: false, last_run_at: null, last_run_status: null, last_run_message: null };
    return data as ProtectImportSource;
  } catch {
    return { drive_file_id: null, enabled: false, last_run_at: null, last_run_status: null, last_run_message: null };
  }
}

// ─────────────────────────────────────────────
// コアロジック: CSV 解析 + 固定判定
// ─────────────────────────────────────────────

interface ProcessResult {
  memberId: string;
  userId: string | null;
  userName: string | null;
  isFixed: boolean;
  fixedReason: string | null;
  skip: boolean;
  skipReason: string | null;
  expiresAt: string | null;
}

async function processProtectCsv(
  csvText: string,
  dryRun: boolean,
): Promise<{
  totalRows: number;
  results: ProcessResult[];
  parseErrors: { row: number; message: string }[];
}> {
  const supabase = await createClient();

  // CSV 解析
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    return { totalRows: 0, results: [], parseErrors: [{ row: 0, message: 'CSVが空です' }] };
  }

  const header = (lines[0] ?? '').split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const dataRows = lines.slice(1);

  // ユーザーキャッシュ: legacy_sf_id → user
  const { data: allUsers } = await supabase
    .from('users')
    .select('id, full_name, legacy_sf_id, is_active')
    .is('deleted_at', null);
  const userBySfId = new Map<string, { id: string; full_name: string | null; is_active: boolean }>();
  for (const u of allUsers ?? []) {
    if (u.legacy_sf_id) userBySfId.set(u.legacy_sf_id, u);
  }

  // アクティブなフロールール(通常プロテクト用)
  const flowRules = await listFlowRules();
  const activeRule = flowRules.find((r) => r.is_active && r.duration_type === 'days_at_time');

  const results: ProcessResult[] = [];
  const parseErrors: { row: number; message: string }[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const rowNum = i + 2;
    const cols = (dataRows[i] ?? '').split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const rowObj: Record<string, string> = {};
    header.forEach((h, idx) => { rowObj[h] = cols[idx] ?? ''; });

    const { memberId, ownerSfId, protectValue } = parseCsvRow(rowObj);

    if (!memberId) {
      parseErrors.push({ row: rowNum, message: '会員IDが見つかりません' });
      continue;
    }

    // free / ex sales はスキップ
    const lv = protectValue?.toLowerCase() ?? '';
    if (!protectValue || lv === 'free' || lv === 'ex sales') {
      results.push({ memberId, userId: null, userName: null, isFixed: false, fixedReason: null, skip: true, skipReason: `${protectValue}(プロテクトなし)`, expiresAt: null });
      continue;
    }

    // 固定プロテクト: protect__c の値がそのまま固定を意味する
    const isFixedByValue = FIXED_PROTECT_VALUES.has(protectValue);

    // ユーザー逆引き(OwnerId → legacy_sf_id)
    const user = ownerSfId ? userBySfId.get(ownerSfId) ?? null : null;

    let isFixed = isFixedByValue;
    let fixedReason: string | null = isFixedByValue ? `protect__c = ${protectValue}` : null;

    if (!isFixed && user) {
      if (!user.is_active) {
        isFixed = true;
        fixedReason = '非アクティブユーザー';
      } else if (user.full_name && FIXED_PROTECT_USER_NAMES.has(user.full_name)) {
        isFixed = true;
        fixedReason = `固定担当ユーザー(${user.full_name})`;
      }
    }

    // メンバーの info_acquired_points チェック(実行時のみ。プレビューは省略)
    if (!isFixed && !dryRun && user) {
      const { data: member } = await supabase
        .from('members')
        .select('info_acquired_points')
        .eq('id', memberId)
        .maybeSingle();
      if (member?.info_acquired_points) {
        for (const kw of FIXED_ACQUIRE_KEYWORDS) {
          if (member.info_acquired_points.includes(kw)) {
            isFixed = true;
            fixedReason = `情報取得ポイント: ${kw}`;
            break;
          }
        }
      }
    }

    const userId = user?.id ?? null;
    const userName = user?.full_name ?? null;

    // 通常プロテクトでユーザー未発見の場合 → スキップ(固定は除く)
    if (!isFixed && !userId) {
      results.push({ memberId, userId: null, userName: null, isFixed: false, fixedReason: null, skip: true, skipReason: ownerSfId ? `ユーザー未発見(${ownerSfId})` : 'OwnerId なし', expiresAt: null });
      continue;
    }

    const expiresAt = isFixed
      ? FIXED_PROTECT_EXPIRES
      : activeRule
        ? calcExpiresAt(activeRule).toISOString()
        : null;

    if (!expiresAt) {
      results.push({ memberId, userId, userName, isFixed: false, fixedReason: null, skip: true, skipReason: 'アクティブなフロールールがありません', expiresAt: null });
      continue;
    }

    results.push({ memberId, userId, userName, isFixed, fixedReason, skip: false, skipReason: null, expiresAt });
  }

  return { totalRows: dataRows.length, results, parseErrors };
}

// ─────────────────────────────────────────────
// 共通: DB 書き込み
// ─────────────────────────────────────────────

async function commitProtectResults(results: ProcessResult[]): Promise<{
  updated: number;
  fixedCount: number;
  normalCount: number;
  errors: { memberId: string; message: string }[];
}> {
  const supabase = await createClient();
  const errors: { memberId: string; message: string }[] = [];
  let updated = 0;
  let fixedCount = 0;
  let normalCount = 0;

  for (const r of results) {
    if (r.skip || !r.expiresAt) continue;
    const { error } = await supabase
      .from('members')
      .update({
        protect_by_user_id: r.userId,
        protect_expires_at: r.expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', r.memberId)
      .is('deleted_at', null);

    if (error) {
      errors.push({ memberId: r.memberId, message: error.message });
    } else {
      updated++;
      if (r.isFixed) fixedCount++; else normalCount++;
    }
  }
  return { updated, fixedCount, normalCount, errors };
}

// ─────────────────────────────────────────────
// Drive 経由
// ─────────────────────────────────────────────

export async function previewProtectImport(fileId: string): Promise<ProtectImportPreview> {
  if (!isDriveConfigured()) return { ok: false, error: 'Google Drive 未設定', totalRows: 0, fixedCount: 0, normalCount: 0, skipCount: 0, errorCount: 0, errors: [] };
  const adminErr = await assertAdmin();
  if (adminErr) return { ok: false, error: adminErr, totalRows: 0, fixedCount: 0, normalCount: 0, skipCount: 0, errorCount: 0, errors: [] };

  try {
    const cleanId = extractDriveFileId(fileId);
    const csvText = await fetchDriveFileCsv(cleanId);
    return await previewFromCsvText(csvText);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '取得に失敗しました', totalRows: 0, fixedCount: 0, normalCount: 0, skipCount: 0, errorCount: 0, errors: [] };
  }
}

export async function runProtectImport(fileId: string): Promise<ProtectImportResult> {
  if (!isDriveConfigured()) return { ok: false, error: 'Google Drive 未設定', updated: 0, fixedCount: 0, normalCount: 0, skipCount: 0, errorCount: 0, errors: [] };
  const adminErr = await assertAdmin();
  if (adminErr) return { ok: false, error: adminErr, updated: 0, fixedCount: 0, normalCount: 0, skipCount: 0, errorCount: 0, errors: [] };

  try {
    const cleanId = extractDriveFileId(fileId);
    const csvText = await fetchDriveFileCsv(cleanId);
    const result = await runFromCsvText(csvText);
    if (result.ok) {
      const supabase = await createClient();
      const msg = `${result.updated}件更新(固定${result.fixedCount}件 / 通常${result.normalCount}件 / スキップ${result.skipCount}件)`;
      await supabase.from('import_sources').upsert(
        { object: PROTECT_OBJECT_KEY, drive_file_id: cleanId, enabled: true, last_run_at: new Date().toISOString(), last_run_status: result.errorCount === 0 ? 'success' : 'partial', last_run_message: msg },
        { onConflict: 'object' },
      );
    }
    return result;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '取込に失敗しました', updated: 0, fixedCount: 0, normalCount: 0, skipCount: 0, errorCount: 0, errors: [] };
  }
}

// ─────────────────────────────────────────────
// ローカルCSVテキスト直接
// ─────────────────────────────────────────────

async function previewFromCsvText(csvText: string): Promise<ProtectImportPreview> {
  const { totalRows, results, parseErrors } = await processProtectCsv(csvText, true);
  const fixedCount = results.filter((r) => !r.skip && r.isFixed).length;
  const normalCount = results.filter((r) => !r.skip && !r.isFixed).length;
  const skipCount = results.filter((r) => r.skip).length;
  return { ok: true, totalRows, fixedCount, normalCount, skipCount, errorCount: parseErrors.length, errors: parseErrors };
}

async function runFromCsvText(csvText: string): Promise<ProtectImportResult> {
  const { totalRows, results, parseErrors } = await processProtectCsv(csvText, false);
  const skipCount = results.filter((r) => r.skip).length;
  const { updated, fixedCount, normalCount, errors } = await commitProtectResults(results);
  return {
    ok: true,
    updated,
    fixedCount,
    normalCount,
    skipCount,
    errorCount: parseErrors.length + errors.length,
    errors: [...parseErrors.map((e) => ({ memberId: `行${e.row}`, message: e.message })), ...errors],
  };
}

/** クライアントから CSV テキストを直接受け取ってプレビュー */
export async function previewProtectImportFromCsvText(csvText: string): Promise<ProtectImportPreview> {
  const adminErr = await assertAdmin();
  if (adminErr) return { ok: false, error: adminErr, totalRows: 0, fixedCount: 0, normalCount: 0, skipCount: 0, errorCount: 0, errors: [] };
  try {
    return await previewFromCsvText(csvText);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '解析に失敗しました', totalRows: 0, fixedCount: 0, normalCount: 0, skipCount: 0, errorCount: 0, errors: [] };
  }
}

/** クライアントから CSV テキストを直接受け取って取込実行 */
export async function runProtectImportFromCsvText(csvText: string): Promise<ProtectImportResult> {
  const adminErr = await assertAdmin();
  if (adminErr) return { ok: false, error: adminErr, updated: 0, fixedCount: 0, normalCount: 0, skipCount: 0, errorCount: 0, errors: [] };
  try {
    return await runFromCsvText(csvText);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '取込に失敗しました', updated: 0, fixedCount: 0, normalCount: 0, skipCount: 0, errorCount: 0, errors: [] };
  }
}
