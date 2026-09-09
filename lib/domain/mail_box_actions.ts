'use server';

/**
 * 受信箱(mail_boxes)の管理者向け設定 Server Actions。CLAUDE.md §5.15 M2。
 * `/settings/mail`(admin のみ)から呼ぶ。RLS(migration 76: mail_boxes の書込は admin のみ)と二重に確認する。
 */

import { getCurrentUser } from '@/lib/domain/auth';
import { sanitizeDisplayName } from '@/lib/domain/mail_compose';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export interface UpdateMailBoxDisplayNameResult {
  error?: string;
}

/**
 * 受信箱の差出人表示名(既定値)を更新する。
 * ここで設定した値が、メーラーの返信・新規作成フォームの初期値になる
 * (送信者は送信時にその場で書き換えることもできる)。
 */
export async function updateMailBoxDisplayName(input: {
  id: number;
  displayName: string | null;
}): Promise<UpdateMailBoxDisplayNameResult> {
  const me = await getCurrentUser();
  if (me.role !== 'admin') {
    return { error: '管理者のみ変更できます' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('mail_boxes')
    .update({ display_name: sanitizeDisplayName(input.displayName) })
    .eq('id', input.id);
  if (error) {
    return { error: `更新に失敗しました: ${error.message}` };
  }

  revalidatePath('/settings/mail');
  return {};
}
