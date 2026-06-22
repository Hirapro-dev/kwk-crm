'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from './auth';
import { APP_STATUSES, FLOW_TYPES } from './applications';

/**
 * 申込ステータス遷移(仕様書 §3 / §5.6)。
 * 仕様書ER図に従い: 対応中 → 未購入/完了 → 出金/資金移動
 *
 * 厳密な遷移ルールは Phase 7 で確定。本フェーズではどの遷移も許可するが、
 * 後ろ向き(完了 → 対応中 等)の遷移は警告のみ。
 */

const UpdateStatusSchema = z.object({
  application_id: z.string().regex(/^M-\d{7}$/),
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
