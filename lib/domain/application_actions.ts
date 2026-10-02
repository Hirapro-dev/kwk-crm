'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { CreateApplicationSchema, startDateToTimestamp } from './application_create_schema';
import { buildApplicationPatch } from './application_edit';
import { APP_STATUSES, FLOW_TYPES } from './applications';
import { getCurrentUser } from './auth';
import { mergeInquiryExtra } from './inquiry_extra_edit';
import { getVisibleFields } from './object_metadata';

/**
 * 申込ステータス遷移(仕様書 §3 / §5.6)。
 * 仕様書ER図に従い: 対応中 → 未購入/完了 → 出金/資金移動
 *
 * 厳密な遷移ルールは Phase 7 で確定。本フェーズではどの遷移も許可するが、
 * 後ろ向き(完了 → 対応中 等)の遷移は警告のみ。
 */

// 実データの申込IDは M- + 9桁ゼロ埋め(例 M-000051826)。旧仕様の 7 桁表記は誤りだったため 2026-09-16 に修正
const APPLICATION_ID_RE = /^M-\d{9}$/;

const UpdateStatusSchema = z.object({
  application_id: z.string().regex(APPLICATION_ID_RE),
  status: z.enum(APP_STATUSES as [string, ...string[]]).optional(),
  flow_type: z.enum(FLOW_TYPES as [string, ...string[]]).optional(),
});

export interface UpdateStatusResult {
  ok: boolean;
  error?: string;
}

export async function updateApplicationStatus(input: {
  application_id: string;
  status?: string;
  flow_type?: string;
}): Promise<UpdateStatusResult> {
  const parsed = UpdateStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '入力エラー' };
  }
  const me = await getCurrentUser();
  if (me.role === 'viewer') {
    return { ok: false, error: '閲覧専用ロールでは操作できません' };
  }

  const supabase = await createClient();
  const update: Record<string, unknown> = {};
  if (parsed.data.status !== undefined) update.status = parsed.data.status;
  if (parsed.data.flow_type !== undefined) update.flow_type = parsed.data.flow_type;
  if (Object.keys(update).length === 0) {
    return { ok: false, error: '更新する項目がありません' };
  }

  const { error } = await supabase
    .from('applications')
    .update(update)
    .eq('id', parsed.data.application_id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/applications');
  revalidatePath(`/applications/${parsed.data.application_id}`);
  return { ok: true };
}

/**
 * 申込の新規登録(申込一覧の「新規登録」。CLAUDE.md §5.6 / §8.1)。
 * ID は DB の連番 gen_application_m_id()(migration 94)で採番する。会員・案件は必須。
 * (gen_application_id という名前は本番 DB に uuid を返す別物が存在するため使わない)
 * viewer は不可(RLS でも書込は viewer 以外)。
 * 担当(owner_id)はフォームに出さず登録者を入れる(2026-09-18。詳細画面で変更できる)。
 * 入金予定日・入金予定額もフォームから外した(必要なら詳細画面で入力)。
 * 契約期間は 起算日時(start_datetime。日本時間で解釈)〜契約期日(contract_end_date。migration 107)と
 * 「●ヶ月」(contract_period)を別に持つ。利息(interest)は既存の円金利(yen_interest)とは別の列で、円金利はフォームに出さない。
 */
type CreateApplicationInput = z.input<typeof CreateApplicationSchema>;

export interface CreateApplicationResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export async function createApplication(
  input: CreateApplicationInput,
): Promise<CreateApplicationResult> {
  const parsed = CreateApplicationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '入力エラー' };
  }
  const me = await getCurrentUser();
  if (me.role === 'viewer') return { ok: false, error: '閲覧専用ロールでは操作できません' };
  const d = parsed.data;
  const supabase = await createClient();

  // 会員・案件の実在確認(削除済みは不可)
  const [{ data: member }, { data: project }] = await Promise.all([
    supabase.from('members').select('id').eq('id', d.memberId).is('deleted_at', null).maybeSingle(),
    supabase.from('projects').select('id').eq('id', d.projectId).maybeSingle(),
  ]);
  if (!member) return { ok: false, error: '会員が見つかりません' };
  if (!project) return { ok: false, error: '案件が見つかりません' };

  // ID 採番(連番。migration 94)
  const { data: newId, error: idErr } = await supabase.rpc('gen_application_m_id');
  if (idErr || typeof newId !== 'string' || !APPLICATION_ID_RE.test(newId)) {
    return {
      ok: false,
      error: `申込IDの採番に失敗しました(migration 94 が未適用の可能性): ${idErr?.message ?? ''}`,
    };
  }

  const { error } = await supabase.from('applications').insert({
    id: newId,
    member_id: d.memberId,
    project_id: d.projectId,
    application_date: d.applicationDate,
    status: d.status,
    flow_type: d.flowType || null,
    owner_id: me.id,
    acquirer_id: d.acquirerId || null,
    contract_sent_date: d.contractSentDate || null,
    interest_type: d.interestType || null,
    interest: d.interest ?? null,
    // 起算日は日付だけ入力(2026-10-01)。日本時間のその日 0 時として保存する
    start_datetime: startDateToTimestamp(d.startDate),
    contract_end_date: d.contractEndDate || null,
    payment_date: d.paymentDate || null,
    payment_amount: d.paymentAmount ?? null,
    contract_period: d.contractPeriod?.trim() || null,
    // 備考は可変項目「備考」に入れる(項目管理に登録済み。2026-10-01)
    extra: d.remarks?.trim() ? { 備考: d.remarks.trim() } : {},
  });
  if (error) return { ok: false, error: `登録に失敗しました: ${error.message}` };

  revalidatePath('/applications');
  revalidatePath(`/members/${d.memberId}`);
  return { ok: true, id: newId };
}

/**
 * 申込の編集(§8.1 `/applications/[id]` の「編集」。admin のみ。2026-10-01)。
 * DB 列は EDITABLE_APPLICATION_COLUMNS のホワイトリスト(変換・検証は純粋関数 buildApplicationPatch)、
 * 可変項目(extra)は項目管理で「詳細」表示 ON の定義済みキーだけ差し替える(他のキーは残す)。
 * 案件・会員・担当・申込獲得者は実在するものだけ受け付ける。
 */
export async function updateApplication(input: {
  id: string;
  /** DB 列(列名 → 入力値の文字列) */
  columns: Record<string, string>;
  /** 可変項目(キー → 値)。空文字はキー削除 */
  extra?: Record<string, string>;
}): Promise<{ error?: string }> {
  const me = await getCurrentUser();
  if (me.role !== 'admin') return { error: '申込の編集は admin のみ可能です' };
  const built = buildApplicationPatch(input.columns);
  if ('error' in built) return { error: built.error };
  const patch: Record<string, unknown> = { ...built.patch };

  const supabase = await createClient();
  const { data: cur, error: curErr } = await supabase
    .from('applications')
    .select('id, member_id, extra')
    .eq('id', input.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (curErr || !cur) return { error: '申込が見つかりません' };

  // 参照先の実在確認(存在しない ID で FK エラーにしない・削除済みの会員に付け替えない)
  const exists = async (table: string, id: unknown, softDelete: boolean) => {
    let q = supabase.from(table).select('id').eq('id', String(id));
    if (softDelete) q = q.is('deleted_at', null);
    const { data } = await q.maybeSingle();
    return !!data;
  };
  if (patch.project_id && !(await exists('projects', patch.project_id, false)))
    return { error: '案件が見つかりません' };
  if (patch.member_id && !(await exists('members', patch.member_id, true)))
    return { error: `会員 ${String(patch.member_id)} が見つかりません(削除済みか、ID の誤り)` };
  for (const k of ['owner_id', 'acquirer_id'] as const) {
    if (patch[k] && !(await exists('users', patch[k], false)))
      return { error: `${k === 'owner_id' ? '担当' : '申込獲得者'}のユーザーが見つかりません` };
  }

  if (input.extra) {
    const defs = await getVisibleFields('applications', 'detail');
    const allowed = new Set(
      defs.filter((f) => !f.is_in_db && !f.is_placeholder).map((f) => f.field_name),
    );
    patch.extra = mergeInquiryExtra(
      (cur as { extra: Record<string, unknown> | null }).extra,
      input.extra,
      allowed,
    );
  }
  if (Object.keys(patch).length === 0) return {};
  const { error } = await supabase.from('applications').update(patch).eq('id', input.id);
  if (error) return { error: `更新に失敗しました: ${error.message}` };
  revalidatePath(`/applications/${input.id}`);
  revalidatePath('/applications');
  const oldMember = (cur as { member_id: string | null }).member_id;
  if (oldMember) revalidatePath(`/members/${oldMember}`);
  if (patch.member_id && patch.member_id !== oldMember)
    revalidatePath(`/members/${String(patch.member_id)}`);
  return {};
}
