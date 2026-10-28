'use server';

/**
 * メーラーの件数表の数え直し(CLAUDE.md §5.15「件数表」/ migration 136。メール設定の「件数を数え直す」)。admin のみ。
 * 件数表はスレッドの変更のたびにトリガーで足し引きされるが、トリガーを通らない書き換えなどで実際と食い違ったときに、
 * 実際の件数で数え直す。関数はサービスロールにしか実行権限が無いため、権限を確かめたうえでサービスロールで呼ぶ。
 */

import { getCurrentUser } from '@/lib/domain/auth';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function rebuildMailThreadCounts(): Promise<{ changed?: number; error?: string }> {
  const me = await getCurrentUser();
  if (me.role !== 'admin') return { error: '管理者のみ実行できます' };
  const { data, error } = await createServiceRoleClient().rpc('rebuild_mail_thread_counts');
  if (error) return { error: `数え直しに失敗しました: ${error.message}` };
  revalidatePath('/mail', 'layout');
  return { changed: Number(data) || 0 };
}
