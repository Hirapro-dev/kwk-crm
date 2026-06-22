'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { ReportDefinition, ReportTypeId } from '@/lib/reports/types';
import { getCurrentUser } from './auth';

const ReportSaveSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().or(z.literal('').transform(() => undefined)),
  report_type: z.string(),
  definition: z.record(z.string(), z.unknown()),
  visibility: z.enum(['private', 'team', 'public']).default('private'),
});

export interface ReportSaveResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export async function saveReport(input: {
  id?: string;
  name: string;
  description?: string;
  report_type: ReportTypeId | 'custom';
  definition: ReportDefinition;
  visibility?: 'private' | 'team' | 'public';
}): Promise<ReportSaveResult> {
  const parsed = ReportSaveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '入力エラー' };
  }
  const me = await getCurrentUser();
  if (me.role === 'viewer') {
    return { ok: false, error: '閲覧専用ロールでは保存できません' };
  }

  const supabase = await createClient();
  const values = {
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    report_type: parsed.data.report_type,
    definition: parsed.data.definition as unknown as object,
    visibility: parsed.data.visibility,
  };

  if (parsed.data.id) {
    const { error } = await supabase
      .from('reports')
      .update(values)
      .eq('id', parsed.data.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath('/reports');
    revalidatePath(`/reports/${parsed.data.id}`);
    return { ok: true, id: parsed.data.id };
  }

  const { data, error } = await supabase
    .from('reports')
    .insert({ ...values, created_by: me.id, is_standard: false })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? '作成失敗' };
  revalidatePath('/reports');
  return { ok: true, id: data.id as string };
}

export async function deleteReport(id: string): Promise<ReportSaveResult> {
  const me = await getCurrentUser();
  const supabase = await createClient();
  // is_standard は admin のみ削除可。RLS でも検証されるが先に弾く。
  const { data: existing } = await supabase
    .from('reports')
    .select('is_standard, created_by')
    .eq('id', id)
    .maybeSingle();
  if (!existing) return { ok: false, error: 'レポートが見つかりません' };
  if (existing.is_standard && me.role !== 'admin') {
    return { ok: false, error: '標準レポートは admin のみ削除可能です' };
  }
  // 論理削除
  const { error } = await supabase
    .from('reports')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/reports');
  return { ok: true };
}

export async function toggleFavorite(reportId: string): Promise<ReportSaveResult> {
  const me = await getCurrentUser();
  const supabase = await createClient();
  const { data: r } = await supabase
    .from('reports')
    .select('favorited_by')
    .eq('id', reportId)
    .maybeSingle();
  if (!r) return { ok: false, error: 'レポートが見つかりません' };
  const arr = (r.favorited_by as string[]) ?? [];
  const next = arr.includes(me.id) ? arr.filter((u) => u !== me.id) : [...arr, me.id];
  const { error } = await supabase
    .from('reports')
    .update({ favorited_by: next })
    .eq('id', reportId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/reports');
  revalidatePath(`/reports/${reportId}`);
  return { ok: true };
}

/**
 * 実行ログを記録(report_runs)。
 * RLS で executed_by = auth.uid() のみ INSERT 可。
 */
export async function logReportRun(input: {
  report_id: string;
  duration_ms: number;
  row_count: number;
  status: 'success' | 'timeout' | 'error';
  error_message?: string;
}): Promise<void> {
  const me = await getCurrentUser();
  const supabase = await createClient();
  await supabase.from('report_runs').insert({
    report_id: input.report_id,
    executed_by: me.id,
    duration_ms: input.duration_ms,
    row_count: input.row_count,
    status: input.status,
    error_message: input.error_message ?? null,
  });
  // last_run_* を reports に書き戻す
  await supabase
    .from('reports')
    .update({
      last_run_at: new Date().toISOString(),
      last_run_duration_ms: input.duration_ms,
      last_run_row_count: input.row_count,
    })
    .eq('id', input.report_id);
}
