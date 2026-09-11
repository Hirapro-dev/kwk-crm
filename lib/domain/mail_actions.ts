'use server';

/**
 * メールスレッドの操作(担当・ステータス・会員紐付け・既読)の Server Actions。
 * CLAUDE.md §5.15。権限は RLS(migration 76: 書込は viewer 以外)と二重にここでも確認する。
 */

import { getCurrentUser } from '@/lib/domain/auth';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { MAIL_CATEGORIES, MAIL_STATUSES, type MailCategory, type MailStatus } from './mail_types';

export interface UpdateMailThreadInput {
  id: string;
  status?: MailStatus;
  /** 自動分類の手直し(誤判定を「通常」に戻す等) */
  category?: MailCategory;
  /** 担当。null で担当解除 */
  assigneeId?: string | null;
  /** 紐付ける会員ID(K-XXXXXXX)。null で解除 */
  memberId?: string | null;
  isRead?: boolean;
}

export interface UpdateMailThreadResult {
  error?: string;
}

export async function updateMailThread(
  input: UpdateMailThreadInput,
): Promise<UpdateMailThreadResult> {
  const me = await getCurrentUser();
  if (me.role === 'viewer') {
    return { error: '閲覧専用ユーザーは変更できません' };
  }
  if (!input.id) return { error: 'スレッドIDが指定されていません' };

  const patch: Record<string, unknown> = {};

  if (input.status !== undefined) {
    if (!MAIL_STATUSES.includes(input.status)) {
      return { error: `不正なステータスです: ${input.status}` };
    }
    patch.status = input.status;
  }
  if (input.category !== undefined) {
    if (!MAIL_CATEGORIES.includes(input.category)) {
      return { error: `不正な分類です: ${input.category}` };
    }
    patch.category = input.category;
  }
  if (input.assigneeId !== undefined) {
    patch.assignee_id = input.assigneeId || null;
  }
  if (input.memberId !== undefined) {
    // 実データは K- + 9桁ゼロ埋め(scripts/import/*.ts の検証と同じ形式。
    // CLAUDE.md §3.1 の「7桁」表記は誤りだったため、こちらに合わせて修正した)
    const m = (input.memberId?.trim() ?? '').toUpperCase();
    if (m && !/^K-\d{9}$/.test(m)) {
      return { error: '会員IDは K-XXXXXXXXX(9桁)形式で指定してください' };
    }
    patch.member_id = m || null;
  }
  if (input.isRead !== undefined) {
    patch.is_read = input.isRead;
  }
  if (Object.keys(patch).length === 0) return {};

  const supabase = await createClient();
  const { error } = await supabase
    .from('mail_threads')
    .update(patch)
    .eq('id', input.id)
    .is('deleted_at', null);
  if (error) {
    return { error: `更新に失敗しました: ${error.message}` };
  }

  revalidatePath('/mail');
  revalidatePath(`/mail/${input.id}`);
  return {};
}

/**
 * スレッドを開いたときに既読にする(Server Component から呼ぶ用)。
 * 失敗しても画面表示は止めない。
 */
export async function markMailThreadRead(id: string): Promise<void> {
  try {
    const me = await getCurrentUser();
    if (me.role === 'viewer') return;
    const supabase = await createClient();
    await supabase
      .from('mail_threads')
      .update({ is_read: true })
      .eq('id', id)
      .eq('is_read', false)
      .is('deleted_at', null);
  } catch {
    /* 既読化は補助的な処理のため握りつぶす */
  }
}
