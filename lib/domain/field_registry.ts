/**
 * 取込で見つかった extra(JSONB) のキーを field_definitions に自動登録する
 * (CLAUDE.md §5.9 / §5.10: CSV取込で新カラム検出 → field_definitions 追加)。
 *
 * - is_in_db=false(extra), is_custom=true で登録
 * - 既定は一覧/詳細とも非表示(オブジェクト管理で管理者が表示ONにする)
 * - 既存(object_id, field_name)はスキップ
 * サーバー専用。import ハンドラから呼ぶ。
 */

import { createClient } from '@/lib/supabase/server';

export async function registerExtraFields(
  objectId: string,
  keys: string[],
): Promise<number> {
  const unique = [...new Set(keys)].filter((k) => k && k.trim() !== '');
  if (unique.length === 0) return 0;

  // biome-ignore lint/suspicious/noExplicitAny: Tables 型が空のため緩い型
  const supabase: any = await createClient();

  // 既存 field_name
  const { data: existing } = await supabase
    .from('field_definitions')
    .select('field_name')
    .eq('object_id', objectId);
  const have = new Set<string>(
    ((existing ?? []) as Array<{ field_name: string }>).map((r) => r.field_name),
  );

  // 既存末尾の並び順
  const { data: last } = await supabase
    .from('field_definitions')
    .select('sort_order_list')
    .eq('object_id', objectId)
    .order('sort_order_list', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  let nextSort = ((last?.sort_order_list as number | undefined) ?? 0) + 10;

  const rows = unique
    .filter((k) => !have.has(k))
    .map((k) => {
      const sort = nextSort;
      nextSort += 10;
      return {
        object_id: objectId,
        field_name: k,
        label: k,
        data_type: 'text',
        is_in_db: false,
        is_custom: true,
        is_system: false,
        is_visible_list: false,
        is_visible_detail: false,
        sort_order_list: sort,
        sort_order_detail: sort,
        csv_column_name: k,
      };
    });
  if (rows.length === 0) return 0;

  // 念のため重複無視で挿入
  const { error } = await supabase
    .from('field_definitions')
    .upsert(rows, { onConflict: 'object_id,field_name', ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  return rows.length;
}
