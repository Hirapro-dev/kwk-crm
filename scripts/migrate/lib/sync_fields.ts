/**
 * extra キーを field_definitions に自動同期するユーティリティ。
 *
 * 移行スクリプト (04_members.ts / 05_inquiries.ts / 06_applications.ts 等) が
 * extra に格納した全キーをスキャンし、field_definitions に未登録のものを自動追加する。
 * これにより CSV に新しいカラムが追加されても migrate:xxx を再実行するだけで
 * フィールド管理画面・詳細画面に自動反映される。
 */

import type { createMigrateClient } from './db';
import { logger } from './logger';

type SupabaseClient = ReturnType<typeof createMigrateClient>;

/** sync_csv_fields.ts と同一のロジック (重複を避けるため共通化) */
export function inferDataType(label: string): string {
  if (/額$|金$|数$|枚$|率$|金利$|料率$|ﾚｰﾄ$|レート$|ﾎﾟｲﾝﾄ$|ポイント$/.test(label)) {
    return 'number';
  }
  if (/日$/.test(label)) return 'date';
  if (/日時$/.test(label)) return 'datetime';
  if (/フラグ$/.test(label)) return 'boolean';
  return 'text';
}

/**
 * extra キーをスキャンして field_definitions に未登録のものを追加する。
 *
 * @param supabase  移行用 Supabase クライアント
 * @param objectId  対象オブジェクト ID (例: 'members', 'inquiries')
 * @param rows      取込済みレコード配列 (extra プロパティを持つ)
 * @param dryRun    true の場合は INSERT しない
 */
export async function syncExtraFieldDefinitions(
  supabase: SupabaseClient,
  objectId: string,
  rows: Array<{ extra: Record<string, unknown> }>,
  dryRun = false,
): Promise<void> {
  // _ 始まりの内部フラグキーを除いた全ユニークキーを収集
  const allKeys = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r.extra)) {
      if (!k.startsWith('_') && k !== 'legacy_breakdown') allKeys.add(k);
    }
  }
  if (allKeys.size === 0) return;

  // 既存の field_definitions を取得
  const { data: existing, error: fetchErr } = await supabase
    .from('field_definitions')
    .select('field_name, sort_order_detail')
    .eq('object_id', objectId);
  if (fetchErr) {
    logger.error(`field_definitions 取得エラー: ${fetchErr.message}`);
    return;
  }

  const existingNames = new Set((existing ?? []).map((f) => f.field_name));
  let maxSort = Math.max(100, ...(existing ?? []).map((f) => f.sort_order_detail ?? 100));

  const toInsert = [...allKeys]
    .filter((k) => !existingNames.has(k))
    .map((k) => {
      maxSort += 10;
      return {
        object_id: objectId,
        field_name: k,
        label: k,
        csv_column_name: k,
        data_type: inferDataType(k),
        is_in_db: false,
        is_visible_list: false,
        is_visible_detail: true,
        is_system: false,
        is_custom: false,
        sort_order_list: maxSort,
        sort_order_detail: maxSort,
      };
    });

  if (toInsert.length === 0) {
    logger.info(`  field_definitions 自動同期: 新規追加なし (${allKeys.size} キー確認済み)`);
    return;
  }

  logger.info(
    `  field_definitions 自動同期: ${toInsert.length} 件追加予定 — ` +
      toInsert
        .slice(0, 5)
        .map((f) => f.field_name)
        .join(', ') +
      (toInsert.length > 5 ? ' ...' : ''),
  );

  if (dryRun) {
    logger.info('  --dry-run: INSERT スキップ');
    return;
  }

  const { error } = await supabase.from('field_definitions').insert(toInsert);
  if (error) {
    logger.error(`  field_definitions INSERT エラー: ${error.message}`);
  } else {
    logger.info(`  field_definitions に ${toInsert.length} 件を追加しました`);
  }
}
