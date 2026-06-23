'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from './auth';
import { ActivityCreateSchema, type ActivityCreateInput } from './activity_schema';
import { applyProtect, detectProtectTrigger } from './protect';

export interface ActivityCreateResult {
  ok: boolean;
  id?: number;
  error?: string;
  fieldErrors?: Record<string, string[]>;
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

  let registeredDatetimeIso: string;
  if (values.registered_at_local) {
    // datetime-local は秒なしのため :00 を補完。タイムゾーンは Asia/Tokyo として ISO 化。
    // クライアント側で Date.toISOString() して送る運用にしてもよいが、ここではローカル文字列のまま使う。
    const local = values.registered_at_local;
    const parsedDate = new Date(local);
    if (Number.isNaN(parsedDate.getTime())) {
      registeredDatetimeIso = new Date().toISOString();
    } else {
      registeredDatetimeIso = parsedDate.toISOString();
    }
  } else {
    registeredDatetimeIso = new Date().toISOString();
  }

  const registeredDate = registeredDatetimeIso.slice(0, 10);

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

  // 時限プロテクト: 通電→7日、接触対応→10日
  if (values.member_id) {
    const trigger = detectProtectTrigger(values.s_bunrui ?? null);
    if (trigger) {
      await applyProtect(supabase, values.member_id, me.id, me.full_name ?? me.email, trigger);
    }
  }

  // 関連ページのキャッシュをパージ
  revalidatePath('/activities');
  revalidatePath('/');
  if (values.member_id) {
    revalidatePath(`/members/${values.member_id}`);
  }

  return { ok: true, id: data.id as number };
}
