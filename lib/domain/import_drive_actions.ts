'use server';

/**
 * Google Drive 定期取込 Server Actions (#1 / admin 限定 / CLAUDE.md §5.10c)
 *
 * - saveImportSource : 対象オブジェクトの Drive ファイル設定を保存(upsert)
 * - previewDriveImport: Drive からCSV取得 → ドライラン(書き込みなし)
 * - runDriveImport    : Drive からCSV取得 → 取込(upsert) + 実行履歴を記録
 *
 * 取込本体は import_actions の previewImport / commitImport を再利用する。
 */

import { revalidatePath } from 'next/cache';
import { extractDriveFileId, fetchDriveFileCsv, isDriveConfigured } from '@/lib/google/drive';
import { IMPORT_OBJECTS } from '@/lib/import/schema';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from './auth';
import {
  commitImport,
  type CommitResult,
  previewImport,
  type PreviewResult,
} from './import_actions';

export interface SimpleResult {
  ok: boolean;
  error?: string;
  message?: string;
}

async function assertAdmin(): Promise<string | null> {
  const me = await getCurrentUser();
  if (me.role !== 'admin') return 'データ取込設定は admin のみ可能です';
  return null;
}

/** SA が設定済みかをクライアントに知らせる(設定方法の案内表示用) */
export async function getDriveStatus(): Promise<{ configured: boolean }> {
  return { configured: isDriveConfigured() };
}

export async function saveImportSource(input: {
  object: string;
  drive_file_id: string;
  enabled: boolean;
}): Promise<SimpleResult> {
  const adminErr = await assertAdmin();
  if (adminErr) return { ok: false, error: adminErr };
  if (!IMPORT_OBJECTS[input.object]) return { ok: false, error: '不明なオブジェクトです' };

  const fileId = input.drive_file_id ? extractDriveFileId(input.drive_file_id) : null;
  const supabase = await createClient();
  const { error } = await supabase.from('import_sources').upsert(
    {
      object: input.object,
      drive_file_id: fileId,
      enabled: input.enabled,
    },
    { onConflict: 'object' },
  );
  if (error) return { ok: false, error: `保存に失敗しました: ${error.message}` };
  revalidatePath('/settings/import-routine');
  return { ok: true, message: '保存しました' };
}

/** 保存済みの Drive ファイルIDを取得 */
async function loadFileId(object: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('import_sources')
    .select('drive_file_id')
    .eq('object', object)
    .maybeSingle();
  const v = (data as { drive_file_id?: string | null } | null)?.drive_file_id;
  return v ?? null;
}

export async function previewDriveImport(object: string): Promise<PreviewResult> {
  const adminErr = await assertAdmin();
  if (adminErr) return { ok: false, error: adminErr };
  if (!isDriveConfigured()) {
    return { ok: false, error: 'Google サービスアカウントが未設定です (GOOGLE_SERVICE_ACCOUNT_JSON)' };
  }
  const fileId = await loadFileId(object);
  if (!fileId) return { ok: false, error: 'Drive ファイルが未設定です。先にファイルを保存してください。' };

  let csv: string;
  try {
    csv = await fetchDriveFileCsv(fileId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return previewImport(object, csv);
}

export async function runDriveImport(object: string): Promise<CommitResult> {
  const adminErr = await assertAdmin();
  if (adminErr) return { ok: false, error: adminErr };
  if (!isDriveConfigured()) {
    return { ok: false, error: 'Google サービスアカウントが未設定です (GOOGLE_SERVICE_ACCOUNT_JSON)' };
  }
  const fileId = await loadFileId(object);
  if (!fileId) return { ok: false, error: 'Drive ファイルが未設定です。' };

  let result: CommitResult;
  let csv: string;
  try {
    csv = await fetchDriveFileCsv(fileId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordRun(object, 'error', msg);
    return { ok: false, error: msg };
  }
  result = await commitImport(object, csv);
  await recordRun(
    object,
    result.ok ? 'success' : 'error',
    result.ok
      ? `${result.upserted ?? 0}件取込` + ((result.errorCount ?? 0) > 0 ? ` / エラー${result.errorCount}件` : '')
      : (result.error ?? '失敗'),
  );
  revalidatePath('/settings/import-routine');
  return result;
}

/** 実行履歴を import_sources に記録(失敗しても本処理は継続) */
async function recordRun(
  object: string,
  status: 'success' | 'error',
  message: string,
): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase
      .from('import_sources')
      .update({
        last_run_at: new Date().toISOString(),
        last_run_status: status,
        last_run_message: message.slice(0, 500),
      })
      .eq('object', object);
  } catch {
    // 履歴記録の失敗は無視
  }
}
