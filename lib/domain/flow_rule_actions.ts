'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCurrentUser } from './auth';

const FlowRuleSchema = z.object({
  name: z.string().min(1, '名前は必須です').max(100),
  trigger_flag: z.string().min(1, 'トリガーフラグは必須です').max(50),
  duration_type: z.enum(['days_at_time', 'hours']),
  duration_value: z.number().int().min(1, '1以上を入力してください'),
  reset_hour: z.number().int().min(0).max(23),
  reset_minute: z.number().int().min(0).max(59),
  is_active: z.boolean(),
  sort_order: z.number().int().min(0),
  // 適用ロール。空配列 = すべてのロールに適用(DBには null を格納)
  apply_roles: z.array(z.enum(['admin', 'manager', 'sales', 'support', 'viewer'])).default([]),
});

export type FlowRuleInput = z.infer<typeof FlowRuleSchema>;

export interface FlowRuleActionResult {
  ok: boolean;
  error?: string;
}

async function assertAdmin() {
  const me = await getCurrentUser();
  if (me.role !== 'admin') throw new Error('管理者権限が必要です');
}

export async function upsertFlowRule(
  id: number | null,
  input: FlowRuleInput,
): Promise<FlowRuleActionResult> {
  try {
    await assertAdmin();
    const parsed = FlowRuleSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
    }

    const supabase = await createClient();
    // 空配列(全ロール)は DB では null として保持
    const { apply_roles, ...rest } = parsed.data;
    const payload = { ...rest, apply_roles: apply_roles.length > 0 ? apply_roles : null };

    if (id) {
      const { error } = await supabase.from('flow_rules').update(payload).eq('id', id);
      if (error) return { ok: false, error: error.message };
    } else {
      const { error } = await supabase.from('flow_rules').insert(payload);
      if (error) return { ok: false, error: error.message };
    }

    revalidatePath('/settings/flows');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteFlowRule(id: number): Promise<FlowRuleActionResult> {
  try {
    await assertAdmin();
    const supabase = await createClient();
    const { error } = await supabase.from('flow_rules').delete().eq('id', id);
    if (error) return { ok: false, error: error.message };
    revalidatePath('/settings/flows');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function toggleFlowRule(id: number, isActive: boolean): Promise<FlowRuleActionResult> {
  try {
    await assertAdmin();
    const supabase = await createClient();
    const { error } = await supabase
      .from('flow_rules')
      .update({ is_active: isActive })
      .eq('id', id);
    if (error) return { ok: false, error: error.message };
    revalidatePath('/settings/flows');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
