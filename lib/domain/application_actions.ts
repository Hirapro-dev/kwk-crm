'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { APP_STATUSES, FLOW_TYPES } from './applications';
import { getCurrentUser } from './auth';

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
 */
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付は YYYY-MM-DD 形式で指定してください');
const optionalDate = z.union([dateStr, z.literal(''), z.null(), z.undefined()]);
const optionalAmount = z.union([z.number().finite().nonnegative(), z.null(), z.undefined()]);

const CreateApplicationSchema = z.object({
  memberId: z.string().regex(/^K-\d{9}$/, '会員を選択してください'),
  projectId: z.number().int().positive('案件を選択してください'),
  applicationDate: dateStr,
  status: z.enum(APP_STATUSES as [string, ...string[]]),
  flowType: z.union([
    z.enum(FLOW_TYPES as [string, ...string[]]),
    z.literal(''),
    z.null(),
    z.undefined(),
  ]),
  ownerId: z.union([z.string().uuid(), z.literal(''), z.null(), z.undefined()]),
  acquirerId: z.union([z.string().uuid(), z.literal(''), z.null(), z.undefined()]),
  scheduledPaymentDate: optionalDate,
  scheduledAmount: optionalAmount,
  paymentDate: optionalDate,
  paymentAmount: optionalAmount,
  contractPeriod: z.union([z.string().max(50), z.null(), z.undefined()]),
});

export type CreateApplicationInput = z.input<typeof CreateApplicationSchema>;

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
    owner_id: d.ownerId || null,
    acquirer_id: d.acquirerId || null,
    scheduled_payment_date: d.scheduledPaymentDate || null,
    scheduled_amount: d.scheduledAmount ?? null,
    payment_date: d.paymentDate || null,
    payment_amount: d.paymentAmount ?? null,
    contract_period: d.contractPeriod?.trim() || null,
    extra: {},
  });
  if (error) return { ok: false, error: `登録に失敗しました: ${error.message}` };

  revalidatePath('/applications');
  revalidatePath(`/members/${d.memberId}`);
  return { ok: true, id: newId };
}
