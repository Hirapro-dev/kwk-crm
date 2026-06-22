'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from './auth';

/**
 * オブジェクト管理マスタの編集 Server Actions (admin 限定)。
 *
 * 仕様書 §5.8 / §5.9 参照。Phase 1: メタデータ管理のみ。
 */

const DATA_TYPES = ['text', 'number', 'date', 'datetime', 'boolean', 'enum', 'jsonb'] as const;

export interface ActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

async function assertAdmin(): Promise<{ ok: true } | ActionResult> {
  const me = await getCurrentUser();
  if (me.role !== 'admin') {
    return { ok: false, error: 'オブジェクト管理は admin のみ可能です' };
  }
  return { ok: true };
}

// ----------------------------------------------------------------------------
// フィールド追加
// ----------------------------------------------------------------------------

const CreateFieldSchema = z.object({
  object_id: z.string().min(1),
  field_name: z
    .string()
    .min(1, 'フィールド名は必須です')
    .max(64)
    .regex(/^[a-z_][a-z0-9_]*$/i, 'フィールド名は半角英数+アンダースコアのみ'),
  label: z.string().max(100).optional(),
  data_type: z.enum(DATA_TYPES).default('text'),
  is_visible_list: z.boolean().default(true),
  is_visible_detail: z.boolean().default(true),
  description: z.string().max(500).optional(),
});

export async function createField(input: {
  object_id: string;
  field_name: string;
  label?: string;
  data_type?: (typeof DATA_TYPES)[number];
  is_visible_list?: boolean;
  is_visible_detail?: boolean;
  description?: string;
}): Promise<ActionResult> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const parsed = CreateFieldSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '入力エラー' };
  }

  const supabase = await createClient();

  // 重複チェック
  const { data: existing } = await supabase
    .from('field_definitions')
    .select('id')
    .eq('object_id', parsed.data.object_id)
    .eq('field_name', parsed.data.field_name)
    .maybeSingle();
  if (existing) {
    return { ok: false, error: '同じフィールド名が既に登録されています' };
  }

  // 末尾の sort_order を取得して +10
  const { data: last } = await supabase
    .from('field_definitions')
    .select('sort_order_list, sort_order_detail')
    .eq('object_id', parsed.data.object_id)
    .order('sort_order_list', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  const nextList = (last?.sort_order_list ?? 0) + 10;
  const nextDetail = (last?.sort_order_detail ?? 0) + 10;

  const { error } = await supabase.from('field_definitions').insert({
    object_id: parsed.data.object_id,
    field_name: parsed.data.field_name,
    label: parsed.data.label || null,
    data_type: parsed.data.data_type,
    is_visible_list: parsed.data.is_visible_list,
    is_visible_detail: parsed.data.is_visible_detail,
    is_system: false,
    is_custom: true,
    sort_order_list: nextList,
    sort_order_detail: nextDetail,
    description: parsed.data.description || null,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/settings/objects');
  return { ok: true, message: 'フィールドを追加しました' };
}

// ----------------------------------------------------------------------------
// フィールド更新 (ラベル/表示/並び順を1つの Action で扱う)
// ----------------------------------------------------------------------------

const UpdateFieldSchema = z.object({
  id: z.number().int().positive(),
  label: z.string().max(100).optional().nullable(),
  data_type: z.enum(DATA_TYPES).optional(),
  is_visible_list: z.boolean().optional(),
  is_visible_detail: z.boolean().optional(),
  sort_order_list: z.number().int().optional(),
  sort_order_detail: z.number().int().optional(),
  description: z.string().max(500).optional().nullable(),
  /** Phase 2.5: セクション名(詳細画面のグルーピング用) */
  section_name: z.string().max(100).optional().nullable(),
});

export async function updateField(input: {
  id: number;
  label?: string | null;
  data_type?: (typeof DATA_TYPES)[number];
  is_visible_list?: boolean;
  is_visible_detail?: boolean;
  sort_order_list?: number;
  sort_order_detail?: number;
  description?: string | null;
  section_name?: string | null;
}): Promise<ActionResult> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const parsed = UpdateFieldSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '入力エラー' };
  }

  const supabase = await createClient();
  const updates: Record<string, unknown> = {};
  if (parsed.data.label !== undefined) updates.label = parsed.data.label || null;
  if (parsed.data.data_type !== undefined) updates.data_type = parsed.data.data_type;
  if (parsed.data.is_visible_list !== undefined)
    updates.is_visible_list = parsed.data.is_visible_list;
  if (parsed.data.is_visible_detail !== undefined)
    updates.is_visible_detail = parsed.data.is_visible_detail;
  if (parsed.data.sort_order_list !== undefined)
    updates.sort_order_list = parsed.data.sort_order_list;
  if (parsed.data.sort_order_detail !== undefined)
    updates.sort_order_detail = parsed.data.sort_order_detail;
  if (parsed.data.description !== undefined)
    updates.description = parsed.data.description || null;
  if (parsed.data.section_name !== undefined)
    updates.section_name = parsed.data.section_name || null;

  if (Object.keys(updates).length === 0) {
    return { ok: false, error: '更新する項目がありません' };
  }

  const { error } = await supabase
    .from('field_definitions')
    .update(updates)
    .eq('id', parsed.data.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/settings/objects');
  return { ok: true, message: '更新しました' };
}

// ----------------------------------------------------------------------------
// フィールド削除 (is_system=true は削除不可)
// ----------------------------------------------------------------------------

export async function deleteField(id: number): Promise<ActionResult> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, error: '不正なIDです' };
  }

  const supabase = await createClient();
  const { data: existing, error: fetchErr } = await supabase
    .from('field_definitions')
    .select('id, is_system, field_name')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) return { ok: false, error: fetchErr.message };
  if (!existing) return { ok: false, error: 'フィールドが見つかりません' };
  if (existing.is_system) {
    return {
      ok: false,
      error: `システム標準フィールド「${existing.field_name}」は削除できません`,
    };
  }

  const { error } = await supabase.from('field_definitions').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/settings/objects');
  return { ok: true, message: '削除しました' };
}

// ----------------------------------------------------------------------------
// レイアウト一括更新 (Phase 2.5)
// DnD 並び替え結果をまとめて保存する。
// 各 item は { id, sort_order, section_name? } を持ち、mode='list' か 'detail' か指定。
// ----------------------------------------------------------------------------

interface ReorderItem {
  id: number;
  sort_order: number;
  section_name?: string | null;
}

export async function reorderFields(
  mode: 'list' | 'detail',
  items: ReorderItem[],
): Promise<ActionResult> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: '更新する項目がありません' };
  }

  const sortCol = mode === 'list' ? 'sort_order_list' : 'sort_order_detail';
  const supabase = await createClient();

  // 1件ずつ UPDATE (件数が多いと遅いが、トランザクション化は将来の RPC で)
  let updated = 0;
  for (const item of items) {
    if (!Number.isInteger(item.id) || item.id <= 0) continue;
    const updates: Record<string, unknown> = {
      [sortCol]: item.sort_order,
    };
    // mode='detail' のときだけ section_name を更新可能
    if (mode === 'detail' && item.section_name !== undefined) {
      updates.section_name = item.section_name || null;
    }
    const { error } = await supabase
      .from('field_definitions')
      .update(updates)
      .eq('id', item.id);
    if (error) {
      return { ok: false, error: `id=${item.id} 更新失敗: ${error.message}` };
    }
    updated++;
  }

  revalidatePath('/settings/objects');
  return { ok: true, message: `${updated}件の並び順を保存しました` };
}

// ----------------------------------------------------------------------------
// 空白セル (placeholder) の追加 / 削除 (Phase 2.5)
// ----------------------------------------------------------------------------

/**
 * 詳細レイアウトに空白セルを1つ追加する。
 * - 物理カラムを持たない (is_in_db=false)
 * - field_name は自動採番 ("__placeholder_<unix_ts>_<rand>")
 * - is_visible_detail=true / is_visible_list=false 固定
 * - section_name は引数で指定可能 (該当セクションの末尾に追加)
 * - sort_order_detail は引数 sort_order を使用 (呼び元で計算)
 */
export async function createPlaceholder(input: {
  object_id: string;
  section_name?: string | null;
  sort_order_detail: number;
}): Promise<ActionResult & { id?: number }> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  if (!input.object_id) return { ok: false, error: 'object_id が必須です' };

  const supabase = await createClient();
  // 一意な field_name を生成
  const fieldName = `__placeholder_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  const { data, error } = await supabase
    .from('field_definitions')
    .insert({
      object_id: input.object_id,
      field_name: fieldName,
      label: null,
      data_type: 'text',
      is_visible_list: false,
      is_visible_detail: true,
      is_system: false,
      is_custom: true,
      is_in_db: false,
      is_placeholder: true,
      sort_order_list: 99999, // 一覧では使わないので末尾に
      sort_order_detail: input.sort_order_detail,
      section_name: input.section_name || null,
      description: '空白セル (レイアウト調整用)',
    })
    .select('id')
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath('/settings/objects');
  return { ok: true, message: '空白を追加しました', id: data?.id };
}

/**
 * 空白セルを削除する (is_placeholder=true のもののみ)。
 * 通常のフィールドを誤って消さないようガード。
 */
export async function deletePlaceholder(id: number): Promise<ActionResult> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, error: '不正なIDです' };
  }

  const supabase = await createClient();
  const { data: existing, error: fetchErr } = await supabase
    .from('field_definitions')
    .select('id, is_placeholder')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) return { ok: false, error: fetchErr.message };
  if (!existing) return { ok: false, error: '対象が見つかりません' };
  if (!existing.is_placeholder) {
    return { ok: false, error: '空白セル以外はこの操作で削除できません' };
  }

  const { error } = await supabase.from('field_definitions').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/settings/objects');
  return { ok: true, message: '空白を削除しました' };
}
