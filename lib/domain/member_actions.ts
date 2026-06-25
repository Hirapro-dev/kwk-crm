'use server';

import { getCurrentUser } from '@/lib/domain/auth';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export interface UpdateMemberInput {
  id: string;
  name?: string;
  name_kana?: string;
  email1?: string;
  email2?: string;
  email3?: string;
  phone1?: string;
  postal_code?: string;
  address?: string;
  customer_type?: string;
  do_not_call?: boolean;
  /** 定期連絡者の users.id。空文字/null で解除。 */
  regular_contact_id?: string | null;
  /** プロテクト者(担当)の users.id。空文字/null で解除。admin のみ変更可。 */
  protect_by_user_id?: string | null;
  /** プロテクト期限 (YYYY-MM-DD または ISO)。空文字/null で無期限解除。admin のみ変更可。 */
  protect_expires_at?: string | null;
}

export async function updateMember(input: UpdateMemberInput): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { id, protect_by_user_id, protect_expires_at, ...fields } = input;
  const hasProtectFields = 'protect_by_user_id' in input || 'protect_expires_at' in input;

  // 空文字は null に変換 (通常フィールド)
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'string') {
      cleaned[k] = v.trim() === '' ? null : v.trim();
    } else {
      cleaned[k] = v;
    }
  }

  // --- プロテクト者・プロテクト日程は admin のみ変更可 ---
  if (hasProtectFields) {
    const me = await getCurrentUser();
    if (me.role !== 'admin') {
      return { error: 'プロテクト者・プロテクト日程の変更は管理者のみ可能です' };
    }

    let cleared = false;
    if ('protect_by_user_id' in input) {
      const uid = protect_by_user_id?.trim() ? protect_by_user_id.trim() : null;
      if (uid) {
        // プロテクト者を設定 → owner_name_raw も担当者名で同期
        const { data: u } = await supabase
          .from('users')
          .select('full_name')
          .eq('id', uid)
          .is('deleted_at', null)
          .maybeSingle();
        cleaned.protect_by_user_id = uid;
        cleaned.owner_name_raw = (u?.full_name as string | null) ?? null;
      } else {
        // プロテクト解除 → owner_name_raw を free に戻し、期限もクリア
        cleaned.protect_by_user_id = null;
        cleaned.owner_name_raw = 'free';
        cleaned.protect_expires_at = null;
        cleared = true;
      }
    }

    // 期限は明示指定があれば反映 (解除時は上で null 済み)
    if ('protect_expires_at' in input && !cleared) {
      cleaned.protect_expires_at = protect_expires_at?.trim() ? protect_expires_at.trim() : null;
    }
  }

  const { error } = await supabase
    .from('members')
    .update(cleaned)
    .eq('id', id)
    .is('deleted_at', null);

  if (error) return { error: error.message };

  revalidatePath(`/members/${id}`);
  revalidatePath('/members');
  return {};
}

/**
 * 会員を論理削除する (admin のみ / 物理削除はしない)。
 * 紐づく申込・対応歴の記録はそのまま残る。
 */
export async function deleteMember(id: string): Promise<{ error?: string }> {
  const me = await getCurrentUser();
  if (me.role !== 'admin') {
    return { error: '会員の削除は管理者のみ可能です' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('members')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null);

  if (error) return { error: error.message };

  revalidatePath('/members');
  return {};
}
