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
import { type AllowedColumnDef, REPORT_SCHEMAS, isSafeIdentifier } from './schema_all';
import type { ReportTypeId } from './types';

/**
 * extra(jsonb)を持つオブジェクトと、レポート内で使われる固定エイリアス。
 * レポートタイプの allowedColumns に該当エイリアスの列が含まれていれば、
 * そのオブジェクトの extra フィールドを読み込む。
 */
const EXTRA_OBJECT_ALIASES: { objectId: string; alias: string }[] = [
  { objectId: 'members', alias: 'm' },
  { objectId: 'inquiries', alias: 'inq' },
  { objectId: 'applications', alias: 'a' },
  { objectId: 'activities', alias: 'act' },
];

/**
 * 指定レポートタイプの主軸オブジェクトに紐づく extra jsonb キーを
 * AllowedColumnDef[] に変換して返す。
 *
 * 戻り値が空配列でもエラーにしない(extra キーを使わないオブジェクトもあり得る)。
 */
export async function loadExtraColumnsForReportType(
  reportType: ReportTypeId,
): Promise<AllowedColumnDef[]> {
  const schema = REPORT_SCHEMAS[reportType];
  if (!schema) return [];

  // このレポートに登場するオブジェクト(主軸+結合先)のうち extra を持つものを抽出。
  // allowedColumns の source に該当エイリアス(例 "m.")が含まれていれば対象とする。
  const targets = EXTRA_OBJECT_ALIASES.filter(({ alias }) =>
    schema.allowedColumns.some((c) => c.source.startsWith(`${alias}.`)),
  );
  if (targets.length === 0) return [];

  const supabase = await createClient();
  const objectIds = targets.map((t) => t.objectId);

  // 全対象オブジェクトの extra フィールドを一括取得
  const { data, error } = await supabase
    .from('field_definitions')
    .select('object_id, field_name, label, is_in_db, is_placeholder')
    .in('object_id', objectIds)
    .eq('is_in_db', false)
    .eq('is_placeholder', false)
    .order('sort_order_detail', { ascending: true })
    .order('field_name', { ascending: true });

  if (error) {
    // ロード失敗時は空配列を返してビルダーは続行できるようにする
    console.error('[extra_columns] field_definitions ロード失敗:', error.message);
    return [];
  }

  const aliasByObject = new Map(targets.map((t) => [t.objectId, t.alias]));
  const results: AllowedColumnDef[] = [];
  for (const row of data ?? []) {
    const objectId = row.object_id as string;
    const alias = aliasByObject.get(objectId);
    if (!alias) continue;
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
