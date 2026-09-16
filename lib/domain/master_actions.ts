'use server';

/**
 * マスター管理(広告マスタ / 顧客情報取得ポイントマスタ)の Server Actions。
 * CLAUDE.md §5.18 / §5.19。admin のみ(RLS と二重に確認)。物理削除はせず is_active で無効化する。
 */

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCurrentUser } from './auth';

export interface MasterActionResult {
  ok: boolean;
  error?: string;
}

async function requireAdmin(): Promise<string | null> {
  const me = await getCurrentUser();
  return me.role === 'admin' ? null : 'マスタは admin のみ編集可能です';
}

const AdSchema = z.object({
  /** 新規は広告IDを入力(既存と同じ N + 7 桁を推奨だが形式は固定しない) */
  id: z.string().trim().min(1, '広告IDを入力してください').max(50),
  ad_type: z.string().trim().min(1, '広告種別を入力してください').max(100),
  name: z.string().trim().min(1, '広告媒体名を入力してください').max(200),
  is_active: z.boolean().default(true),
  /** true なら既存行の更新(id は変更不可)。false なら新規作成(同じ id があればエラー) */
  isUpdate: z.boolean().default(false),
});

export async function upsertAdMaster(input: z.input<typeof AdSchema>): Promise<MasterActionResult> {
  const parsed = AdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? '入力エラー' };
  const denied = await requireAdmin();
  if (denied) return { ok: false, error: denied };
  const d = parsed.data;
  const supabase = await createClient();
  if (d.isUpdate) {
    const { error } = await supabase
      .from('ad_masters')
      .update({ ad_type: d.ad_type, name: d.name, is_active: d.is_active })
      .eq('id', d.id);
    if (error) return { ok: false, error: `更新に失敗しました: ${error.message}` };
  } else {
    const { error } = await supabase
      .from('ad_masters')
      .insert({ id: d.id, ad_type: d.ad_type, name: d.name, is_active: d.is_active });
    if (error) {
      return {
        ok: false,
        error:
          error.code === '23505'
            ? `広告ID ${d.id} は既に登録されています`
            : `追加に失敗しました: ${error.message}`,
      };
    }
  }
  revalidatePath('/settings/ads');
  return { ok: true };
}

const PointSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1, '名前を入力してください').max(200),
  sort_order: z.number().int().min(0).max(100000).default(100),
  is_active: z.boolean().default(true),
});

export async function upsertAcquisitionPoint(
  input: z.input<typeof PointSchema>,
): Promise<MasterActionResult> {
  const parsed = PointSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? '入力エラー' };
  const denied = await requireAdmin();
  if (denied) return { ok: false, error: denied };
  const d = parsed.data;
  const supabase = await createClient();
  const values = { name: d.name, sort_order: d.sort_order, is_active: d.is_active };
  const { error } = d.id
    ? await supabase.from('acquisition_point_masters').update(values).eq('id', d.id)
    : await supabase.from('acquisition_point_masters').insert(values);
  if (error) {
    return {
      ok: false,
      error:
        error.code === '23505'
          ? `「${d.name}」は既に登録されています`
          : `保存に失敗しました: ${error.message}`,
    };
  }
  revalidatePath('/settings/acquisition-points');
  return { ok: true };
}

/** 広告マスタの検索(【取得】ボタンの選択ダイアログ用。全ロール。有効な広告のみ、最大 200 件) */
export async function searchAdMasters(input: {
  q?: string;
  adType?: string;
}): Promise<{
  error?: string;
  rows?: Array<{ id: string; ad_type: string; name: string }>;
  adTypes?: string[];
}> {
  await getCurrentUser();
  const supabase = await createClient();
  let query = supabase
    .from('ad_masters')
    .select('id, ad_type, name')
    .eq('is_active', true)
    .order('ad_type', { ascending: true })
    .order('id', { ascending: true })
    .limit(200);
  if (input.adType) query = query.eq('ad_type', input.adType);
  const q = (input.q ?? '').trim().replace(/[%_]/g, '\\$&');
  if (q) query = query.or(`id.ilike.%${q}%,name.ilike.%${q}%`);
  const [{ data, error }, { data: types }] = await Promise.all([
    query,
    supabase.from('ad_masters').select('ad_type').eq('is_active', true),
  ]);
  if (error) return { error: `広告マスタの取得に失敗しました: ${error.message}` };
  const adTypes = [
    ...new Set(((types ?? []) as unknown as Array<{ ad_type: string }>).map((t) => t.ad_type)),
  ].sort();
  return {
    rows: (data ?? []) as unknown as Array<{ id: string; ad_type: string; name: string }>,
    adTypes,
  };
}

/** 顧客情報取得ポイントマスタの有効な名前一覧(会員の新規登録フォームの選択肢用。全ロール) */
export async function listAcquisitionPointNames(): Promise<string[]> {
  await getCurrentUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('acquisition_point_masters')
    .select('name')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) return [];
  return ((data ?? []) as unknown as Array<{ name: string }>).map((r) => r.name);
}
