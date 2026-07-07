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
import {
  type AllowedColumnDef,
  type DataType,
  REPORT_SCHEMAS,
  isSafeIdentifier,
} from './schema_all';
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
  { objectId: 'article_reactions', alias: 'ar' },
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

  // 全対象オブジェクトのフィールドを一括取得(extra jsonb + 実DBカラム両方)。
  // is_placeholder(空白セル)は除外する。
  const { data, error } = await supabase
    .from('field_definitions')
    .select('object_id, field_name, label, data_type, is_in_db, is_placeholder')
    .in('object_id', objectIds)
    .eq('is_placeholder', false)
    .order('sort_order_detail', { ascending: true })
    .order('field_name', { ascending: true });

  if (error) {
    // ロード失敗時は空配列を返してビルダーは続行できるようにする
    console.error('[extra_columns] field_definitions ロード失敗:', error.message);
    return [];
  }

  // 既にハードコードのホワイトリスト(schema_all.ts)に存在する source は重複追加しない。
  const existingSources = new Set(schema.allowedColumns.map((c) => c.source));

  const aliasByObject = new Map(targets.map((t) => [t.objectId, t.alias]));
  const results: AllowedColumnDef[] = [];
  for (const row of data ?? []) {
    const objectId = row.object_id as string;
    const alias = aliasByObject.get(objectId);
    if (!alias) continue;
    const fieldName = row.field_name as string;
    const label = (row.label as string | null) ?? fieldName;
    const realType = (row.data_type as DataType | null) ?? 'text';

    if (row.is_in_db) {
      // 実DBカラム。ハードコード未登録のものだけ「そのままのカラム」として追加。
      // (xels_insider_joined_at 等、後から追加された列もレポートで選べるようにする)
      const source = `${alias}.${fieldName}`;
      if (existingSources.has(source)) continue; // 既にホワイトリスト済み
      if (!isSafeIdentifier(source)) continue;
      results.push({
        source,
        label,
        dataType: realType, // 実型(date/number/text 等)をそのまま使う
        filterable: true,
        sortable: true,
        groupable: true,
        aggregatable: false,
      });
    } else {
      // extra jsonb キー。source は alias.extra:key 形式。
      const source = `${alias}.extra:${fieldName}`;
      if (!isSafeIdentifier(source)) continue;
      results.push({
        source,
        label,
        dataType: 'text', // ->> は常に text
        displayType: realType, // 表示整形用に実型を持たせる
        isExtra: true,
        filterable: true,
        sortable: true,
        groupable: true,
        aggregatable: false, // 数値集計は CAST が必要なので将来課題
      });
    }
  }
  return results;
}
