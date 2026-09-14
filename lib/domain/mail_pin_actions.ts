'use server';

/**
 * 受信箱のピン留め(ユーザーごと)の Server Actions。CLAUDE.md §5.15 / migration 84。
 * メーラー左フォルダのピンボタンから呼ぶ。行は実行ユーザー自身のものだけ
 * (RLS: user_id = auth.uid())で、ここでも user_id に自分の ID を入れて二重に確認する。
 */

import { getCurrentUser } from '@/lib/domain/auth';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export interface MailPinActionResult {
  error?: string;
}

function validBoxId(mailBoxId: number): boolean {
  return Number.isInteger(mailBoxId) && mailBoxId > 0;
}

export async function pinMailBox(mailBoxId: number): Promise<MailPinActionResult> {
  if (!validBoxId(mailBoxId)) return { error: '受信箱の指定が不正です' };
  const me = await getCurrentUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from('mail_box_pins')
    .upsert(
      { user_id: me.id, mail_box_id: mailBoxId },
      { onConflict: 'user_id,mail_box_id', ignoreDuplicates: true },
    );
  if (error) return { error: `ピン留めに失敗しました: ${error.message}` };
  revalidatePath('/mail', 'layout');
  return {};
}

export async function unpinMailBox(mailBoxId: number): Promise<MailPinActionResult> {
  if (!validBoxId(mailBoxId)) return { error: '受信箱の指定が不正です' };
  const me = await getCurrentUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from('mail_box_pins')
    .delete()
    .eq('user_id', me.id)
    .eq('mail_box_id', mailBoxId);
  if (error) return { error: `ピン留めの解除に失敗しました: ${error.message}` };
  revalidatePath('/mail', 'layout');
  return {};
}
