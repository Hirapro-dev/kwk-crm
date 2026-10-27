'use server';

/**
 * マスター管理(広告マスタ / 顧客情報取得ポイントマスタ)の Server Actions。
 * CLAUDE.md §5.18 / §5.19。admin のみ(RLS と二重に確認)。物理削除はせず is_active で無効化する。
 */

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { type AdPick, RECENT_AD_PICK_DAYS, splitRecentAds } from './ad_recent_picks';
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
  /** 直近 1 か月に(全員の誰かが)選んだ広告。最近選ばれた順(§5.18) */
  recent?: Array<{ id: string; ad_type: string; name: string }>;
  rows?: Array<{ id: string; ad_type: string; name: string }>;
  adTypes?: string[];
}> {
  await getCurrentUser();
  const supabase = await createClient();
  const since = new Date(Date.now() - RECENT_AD_PICK_DAYS * 86_400_000).toISOString();
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
  const [{ data, error }, { data: types }, { data: picks }] = await Promise.all([
    query,
    supabase.from('ad_masters').select('ad_type').eq('is_active', true),
    // 選んだ記録(migration 132)。テーブル未適用・取得失敗なら「最近」は空にして一覧は壊さない
    supabase
      .from('ad_master_picks')
      .select('ad_id, picked_at')
      .gte('picked_at', since)
      .order('picked_at', { ascending: false })
      .limit(1000),
  ]);
  if (error) return { error: `広告マスタの取得に失敗しました: ${error.message}` };
  const adTypes = [
    ...new Set(((types ?? []) as unknown as Array<{ ad_type: string }>).map((t) => t.ad_type)),
  ].sort();
  const { recent, others } = splitRecentAds(
    (data ?? []) as unknown as Array<{ id: string; ad_type: string; name: string }>,
    (picks ?? []) as AdPick[],
  );
  return { recent, rows: others, adTypes };
}

/**
 * 広告マスタの【取得】で広告を選んだことを記録する(「最近選んだ広告」用。§5.18)。
 * viewer は編集画面を使わないので記録しない。記録に失敗しても選択自体は止めない(呼び出し側は結果を見ない)。
 */
export async function recordAdMasterPick(adId: string): Promise<MasterActionResult> {
  const me = await getCurrentUser();
  if (me.role === 'viewer') return { ok: false, error: '閲覧専用ユーザーは記録しません' };
  const id = z.string().trim().min(1).max(50).safeParse(adId);
  if (!id.success) return { ok: false, error: '広告IDが不正です' };
  const supabase = await createClient();
  const { error } = await supabase
    .from('ad_master_picks')
    .insert({ ad_id: id.data, picked_by: me.id });
  if (error) return { ok: false, error: `選んだ記録の保存に失敗しました: ${error.message}` };
  return { ok: true };
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
