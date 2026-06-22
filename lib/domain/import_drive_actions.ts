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
import { commitInquiriesCsv, previewInquiriesCsv } from './import_inquiries';

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
  drive_file_id_2?: string;
  enabled: boolean;
  update_only?: boolean;
}): Promise<SimpleResult> {
  const adminErr = await assertAdmin();
  if (adminErr) return { ok: false, error: adminErr };
  if (!IMPORT_OBJECTS[input.object]) return { ok: false, error: '不明なオブジェクトです' };

  const fileId = input.drive_file_id ? extractDriveFileId(input.drive_file_id) : null;
  const fileId2 = input.drive_file_id_2 ? extractDriveFileId(input.drive_file_id_2) : null;
  const supabase = await createClient();
  const { error } = await supabase.from('import_sources').upsert(
    {
      object: input.object,
      drive_file_id: fileId,
      drive_file_id_2: fileId2,
      enabled: input.enabled,
      update_only: input.update_only ?? false,
    },
    { onConflict: 'object' },
  );
  if (error) return { ok: false, error: `保存に失敗しました: ${error.message}` };
  revalidatePath('/settings/import-routine');
  return { ok: true, message: '保存しました' };
}

/** 更新のみ設定を取得 */
async function loadUpdateOnly(object: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('import_sources')
    .select('update_only')
    .eq('object', object)
    .maybeSingle();
  return Boolean((data as { update_only?: boolean } | null)?.update_only);
}

/** 保存済みの Drive ファイルID(1つ目/2つ目)を取得 */
async function loadFileIds(
  object: string,
): Promise<{ file1: string | null; file2: string | null }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('import_sources')
    .select('drive_file_id,drive_file_id_2')
    .eq('object', object)
    .maybeSingle();
  const row = data as { drive_file_id?: string | null; drive_file_id_2?: string | null } | null;
  return { file1: row?.drive_file_id ?? null, file2: row?.drive_file_id_2 ?? null };
}

/** 設定済みファイルを Drive から取得して CSV テキスト配列にする */
async function fetchConfiguredCsvs(object: string): Promise<string[]> {
  const { file1, file2 } = await loadFileIds(object);
  const ids = [file1, file2].filter((v): v is string => !!v);
  const texts: string[] = [];
  for (const id of ids) texts.push(await fetchDriveFileCsv(id));
  return texts;
}

export async function previewDriveImport(object: string): Promise<PreviewResult> {
  const adminErr = await assertAdmin();
  if (adminErr) return { ok: false, error: adminErr };
  if (!isDriveConfigured()) {
    return { ok: false, error: 'Google サービスアカウントが未設定です (GOOGLE_SERVICE_ACCOUNT_JSON)' };
  }

  let texts: string[];
  try {
    texts = await fetchConfiguredCsvs(object);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (texts.length === 0) {
    return { ok: false, error: 'Drive ファイルが未設定です。先にファイルを保存してください。' };
  }

  const updateOnly = await loadUpdateOnly(object);
  // 問合せは2ファイルを統合して専用ハンドラへ。他は1ファイルを汎用ハンドラへ。
  if (object === 'inquiries') return previewInquiriesCsv(texts, updateOnly);
  return previewImport(object, texts[0] as string, updateOnly);
}

export async function runDriveImport(object: string): Promise<CommitResult> {
  const adminErr = await assertAdmin();
  if (adminErr) return { ok: false, error: adminErr };
  if (!isDriveConfigured()) {
    return { ok: false, error: 'Google サービスアカウントが未設定です (GOOGLE_SERVICE_ACCOUNT_JSON)' };
  }

  let texts: string[];
  try {
    texts = await fetchConfiguredCsvs(object);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordRun(object, 'error', msg);
    return { ok: false, error: msg };
  }
  if (texts.length === 0) return { ok: false, error: 'Drive ファイルが未設定です。' };

  const updateOnly = await loadUpdateOnly(object);
  const result =
    object === 'inquiries'
      ? await commitInquiriesCsv(texts, updateOnly)
      : await commitImport(object, texts[0] as string, updateOnly);
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
