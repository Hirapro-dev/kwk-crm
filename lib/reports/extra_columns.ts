/**
 * field_definitions から extra jsonb キー一覧をロードし、レポートビルダー用の
 * AllowedColumnDef[] に変換するサーバーサイドヘルパー。
 *
 * 設計:
 *   - object_definitions.id をキーに field_definitions を取得
 *   - is_in_db=false かつ is_placeholder=false のフィールドを抽出
 *     (=DB物理カラムではなく extra jsonb 内のキー)
 *   - 各フィールドを { source: 'alias.extra:field_name', isExtra: true, dataType: 'text', ... }
 *     形式の AllowedColumnDef に変換
 *
 * 注意:
 *   - PostgreSQL の extra->>'key' は常に text を返すため、dataType は 'text' 固定
 *   - 数値や日付として扱いたい場合は将来 CAST 対応(::numeric, ::date)を別途実装する
 *   - フィルタは contains/equals 等のテキスト演算子のみ意味を成す
 */

import { createClient } from '@/lib/supabase/server';
import type { ReportTypeId } from './types';
import {
  type AllowedColumnDef,
  REPORT_BASE_OBJECT,
  getBaseAlias,
  isSafeIdentifier,
} from './schema_all';

/**
 * 指定レポートタイプの主軸オブジェクトに紐づく extra jsonb キーを
 * AllowedColumnDef[] に変換して返す。
 *
 * 戻り値が空配列でもエラーにしない(extra キーを使わないオブジェクトもあり得る)。
 */
export async function loadExtraColumnsForReportType(
  reportType: ReportTypeId,
): Promise<AllowedColumnDef[]> {
  const objectId = REPORT_BASE_OBJECT[reportType];
  if (!objectId) return [];
  const alias = getBaseAlias(reportType);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('field_definitions')
    .select('field_name, label, is_in_db, is_placeholder')
    .eq('object_id', objectId)
    .eq('is_in_db', false)
    .eq('is_placeholder', false)
    .order('sort_order_detail', { ascending: true })
    .order('field_name', { ascending: true });

  if (error) {
    // ロード失敗時は空配列を返してビルダーは続行できるようにする
    console.error('[extra_columns] field_definitions ロード失敗:', error.message);
    return [];
  }

  const results: AllowedColumnDef[] = [];
  for (const row of data ?? []) {
    const fieldName = row.field_name as string;
    const label = (row.label as string | null) ?? fieldName;
    const source = `${alias}.extra:${fieldName}`;
    // 防御: 不正な識別子は除外(SQL Builder のホワイトリスト検証と二重ガード)
    if (!isSafeIdentifier(source)) continue;
    results.push({
      source,
      label,
      dataType: 'text', // ->> は常に text
      isExtra: true,
      filterable: true,
      sortable: true,
      groupable: true,
      aggregatable: false, // 数値集計は CAST が必要なので将来課題
    });
  }
  return results;
}
