'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from './auth';

/**
 * 2026-05 更新: projects.category カラム廃止に伴い category 関連の入力を削除。
 */

const UpsertSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().or(z.literal('').transform(() => undefined)),
  is_active: z.boolean().default(true),
});

export interface ProjectResult {
  ok: boolean;
  id?: number;
  error?: string;
}

export async function upsertProject(input: {
  id?: number;
  name: string;
  description?: string;
  is_active?: boolean;
}): Promise<ProjectResult> {
  const parsed = UpsertSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '入力エラー' };
  }
  const me = await getCurrentUser();
  if (me.role !== 'admin') {
    return { ok: false, error: '案件マスタは admin のみ編集可能です' };
  }

  const supabase = await createClient();
  const values = {
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    is_active: parsed.data.is_active,
  };

  if (parsed.data.id) {
    const { error } = await supabase
      .from('projects')
      .update(values)
      .eq('id', parsed.data.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath('/projects');
    return { ok: true, id: parsed.data.id };
  }
  const { data, error } = await supabase
    .from('projects')
    .insert(values)
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? '作成に失敗' };
  revalidatePath('/projects');
  return { ok: true, id: data.id as number };
}
