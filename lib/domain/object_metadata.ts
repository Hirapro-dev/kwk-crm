/**
 * オブジェクト管理マスタ ドメインロジック (Phase 1)
 *
 * 仕様書 §5.8 / §5.9 参照。
 *
 * Phase 1 スコープ:
 *   - 一覧/詳細用の表示制御メタデータの取得・更新
 *   - 実画面への動的反映は Phase 2 以降
 */

import { createClient } from '@/lib/supabase/server';

export interface ObjectDefinition {
  id: string;
  label: string;
  icon_label: string | null;
  icon_color: string | null;
  sort_order: number;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface FieldDefinition {
  id: number;
  object_id: string;
  field_name: string;
  label: string | null;
  data_type: 'text' | 'number' | 'date' | 'datetime' | 'boolean' | 'enum' | 'jsonb';
  is_visible_list: boolean;
  is_visible_detail: boolean;
  is_system: boolean;
  is_custom: boolean;
  sort_order_list: number;
  sort_order_detail: number;
  description: string | null;
  /** 元のCSVヘッダー文字列。CSV由来でないなら NULL */
  csv_column_name: string | null;
  /** DB物理カラムがあるか。false なら CSV取込時に extra jsonb 行き */
  is_in_db: boolean;
  /** セクション名 (Phase 2.5)。詳細画面のグルーピング表示に使う。NULL=未分類 */
  section_name: string | null;
  /** 空白セル (Phase 2.5)。true なら詳細画面で空の枠として描画。一覧では非表示。 */
  is_placeholder: boolean;
  /** ハイライトパネル(詳細ヘッダー下部)に表示するか */
  is_visible_highlight: boolean;
  /** ハイライトパネル内での表示順 */
  sort_order_highlight: number;
  created_at: string;
  updated_at: string;
}

/** 全オブジェクト一覧を sort_order 順で取得 */
export async function listObjectDefinitions(): Promise<ObjectDefinition[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('object_definitions')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw new Error(`オブジェクト一覧取得に失敗: ${error.message}`);
  return (data ?? []) as ObjectDefinition[];
}

/** 単一オブジェクト取得 */
export async function getObjectDefinition(id: string): Promise<ObjectDefinition | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('object_definitions')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`オブジェクト取得に失敗: ${error.message}`);
  return (data as ObjectDefinition) ?? null;
}

/**
 * 指定オブジェクトのフィールド一覧。
 * mode='list' なら sort_order_list、'detail' なら sort_order_detail で並べる。
 */
export async function listFieldDefinitions(
  objectId: string,
  mode: 'list' | 'detail' = 'list',
): Promise<FieldDefinition[]> {
  const supabase = await createClient();
  const orderCol = mode === 'list' ? 'sort_order_list' : 'sort_order_detail';
  const { data, error } = await supabase
    .from('field_definitions')
    .select('*')
    .eq('object_id', objectId)
    .order(orderCol, { ascending: true })
    .order('field_name', { ascending: true });
  if (error) throw new Error(`フィールド一覧取得に失敗: ${error.message}`);
  return (data ?? []) as FieldDefinition[];
}

/**
 * 指定オブジェクトで「表示ONになっている」フィールドだけを取得。
 * mode='list'      → is_visible_list=true、sort_order_list 順
 * mode='detail'    → is_visible_detail=true、sort_order_detail 順
 * mode='highlight' → is_visible_highlight=true、sort_order_highlight 順
 * 動的レンダリング (Phase 2 以降) で使用。
 */
export async function getVisibleFields(
  objectId: string,
  mode: 'list' | 'detail' | 'highlight',
): Promise<FieldDefinition[]> {
  const supabase = await createClient();

  if (mode === 'highlight') {
    const { data, error } = await supabase
      .from('field_definitions')
      .select('*')
      .eq('object_id', objectId)
      .eq('is_visible_highlight', true)
      .order('sort_order_highlight', { ascending: true })
      .order('field_name', { ascending: true });
    if (error) throw new Error(`ハイライトフィールド取得に失敗: ${error.message}`);
    return (data ?? []) as FieldDefinition[];
  }

  const all = await listFieldDefinitions(objectId, mode);
  if (mode === 'list') {
    return all.filter((f) => f.is_visible_list);
  }
  return all.filter((f) => f.is_visible_detail);
}
