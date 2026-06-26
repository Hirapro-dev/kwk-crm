'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { type ActivityCreateInput, ActivityCreateSchema } from './activity_schema';
import { getCurrentUser } from './auth';
import { applyProtect } from './protect';

export interface ActivityCreateResult {
  ok: boolean;
  id?: number;
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

/**
 * datetime-local の文字列(JSTの壁時計、例 "2026-06-26T12:45")を
 * Asia/Tokyo として解釈し、正しい UTC ISO に変換する。
 *
 * サーバー(Vercel=UTC)で new Date("2026-06-26T12:45") とすると UTC として
 * 解釈され +9 ずれるため、明示的に +09:00 を付与する。
 * 解釈不能なら現在時刻を返す。
 */
function jstLocalToIso(local: string | null | undefined): string {
  if (!local) return new Date().toISOString();
  // "YYYY-MM-DDTHH:MM" → 秒を補完。既に秒/タイムゾーン付きはそのまま尊重。
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(local);
  let s = local;
  if (!hasTz) {
    if (/T\d{2}:\d{2}$/.test(local)) s = `${local}:00+09:00`;
    else s = `${local}+09:00`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** ISO文字列から JST の YYYY-MM-DD を返す(registered_date 用)。 */
function jstYmd(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * 対応歴入力の Server Action(仕様書 §8.2 「主役画面」)。
 * RLS により sales は自分作成のもののみ、admin/manager は全件。
 *
 * 仕様書 §12.1: フォーム検証は Zod。
 * 仕様書 §10 Phase 4: 楽観的更新、エラー時のみロールバック(クライアント側)。
 */
export async function createActivity(input: ActivityCreateInput): Promise<ActivityCreateResult> {
  const parsed = ActivityCreateSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { ok: false, error: '入力内容を確認してください', fieldErrors };
  }
  const values = parsed.data;

  const me = await getCurrentUser();
  if (me.role === 'viewer') {
    return { ok: false, error: '閲覧専用ロールでは記録できません' };
  }

  const supabase = await createClient();

  // datetime-local(JSTの壁時計)を Asia/Tokyo として正しく UTC ISO 化する
  const registeredDatetimeIso = jstLocalToIso(values.registered_at_local);
  // 表示用の日付は JST 基準で算出(UTC slice だと日付がずれるため)
  const registeredDate = jstYmd(registeredDatetimeIso);

  const { data, error } = await supabase
    .from('activities')
    .insert({
      owner_id: me.id,
      created_by_id: me.id,
      member_id: values.member_id ?? null,
      d_bunrui: values.d_bunrui,
      m_bunrui: values.m_bunrui ?? null,
      s_bunrui: values.s_bunrui ?? null,
      description: values.description ?? null,
      registered_date: registeredDate,
      registered_datetime: registeredDatetimeIso,
    })
    .select('id')
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? '登録に失敗しました' };
  }

  // 時限プロテクト: flow_rules のルールにマッチした場合に自動設定
  if (values.member_id) {
    await applyProtect(
      supabase,
      values.member_id,
      me.id,
      me.full_name ?? me.email,
      values.s_bunrui ?? null,
      me.role,
    );
  }

  // 関連ページのキャッシュをパージ
  revalidatePath('/activities');
  revalidatePath('/');
  if (values.member_id) {
    revalidatePath(`/members/${values.member_id}`);
  }

  return { ok: true, id: data.id as number };
}

export interface ActivityUpdateResult {
  ok: boolean;
  error?: string;
}

/**
 * 対応歴更新の Server Action。
 * 本人(created_by_id)または admin のみ更新可(RLS + アプリ層の二重チェック)。
 */
export async function updateActivity(
  id: number,
  input: ActivityCreateInput,
): Promise<ActivityUpdateResult> {
  const parsed = ActivityCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: '入力内容を確認してください' };
  }
  const values = parsed.data;

  const me = await getCurrentUser();
  if (me.role === 'viewer') {
    return { ok: false, error: '閲覧専用ロールでは編集できません' };
  }

  const supabase = await createClient();

  // datetime-local(JSTの壁時計)を Asia/Tokyo として正しく UTC ISO 化する
  const registeredDatetimeIso = values.registered_at_local
    ? jstLocalToIso(values.registered_at_local)
    : undefined;

  const updatePayload: Record<string, unknown> = {
    d_bunrui: values.d_bunrui,
    m_bunrui: values.m_bunrui ?? null,
    s_bunrui: values.s_bunrui ?? null,
    description: values.description ?? null,
  };
  if (registeredDatetimeIso) {
    updatePayload.registered_datetime = registeredDatetimeIso;
    updatePayload.registered_date = jstYmd(registeredDatetimeIso);
  }

  const { error } = await supabase.from('activities').update(updatePayload).eq('id', id);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath('/activities');
  revalidatePath('/');
  return { ok: true };
}
