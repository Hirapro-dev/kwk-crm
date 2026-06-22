/**
 * 定期取込ソース(import_sources)の取得 (CLAUDE.md §5.10c)
 * テーブル未適用・空・エラー時は既定(未設定の4オブジェクト)にフォールバック。
 */

import { createClient } from '@/lib/supabase/server';
import { IMPORT_OBJECT_KEYS } from '@/lib/import/schema';

export interface ImportSource {
  object: string;
  drive_file_id: string | null;
  /** 2つ目のファイル(問合せの2フォーム統合用。他オブジェクトは未使用) */
  drive_file_id_2: string | null;
  enabled: boolean;
  note: string | null;
  last_run_at: string | null;
  last_run_status: string | null;
  last_run_message: string | null;
}

function blank(object: string): ImportSource {
  return {
    object,
    drive_file_id: null,
    drive_file_id_2: null,
    enabled: false,
    note: null,
    last_run_at: null,
    last_run_status: null,
    last_run_message: null,
  };
}

function defaults(): ImportSource[] {
  return IMPORT_OBJECT_KEYS.map((object) => blank(object));
}

const COLS =
  'object,drive_file_id,drive_file_id_2,enabled,note,last_run_at,last_run_status,last_run_message';

export async function getImportSources(): Promise<ImportSource[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from('import_sources').select(COLS);
    if (error || !data) return defaults();
    // 既知の取込対象オブジェクト分を、行が無ければ既定で補完して返す
    const byObj = new Map<string, ImportSource>();
    for (const r of data as unknown as ImportSource[]) byObj.set(r.object, r);
    return IMPORT_OBJECT_KEYS.map((object) => byObj.get(object) ?? blank(object));
  } catch {
    return defaults();
  }
}
