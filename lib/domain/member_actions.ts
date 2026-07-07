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
  /** 実質名義人 */
  real_name?: string;
  /** 性別 */
  gender?: string;
  /** 生年月日 (YYYY-MM-DD)。空文字で解除 */
  birthdate?: string;
  /** 紹介者氏名 */
  referrer_name?: string;
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
      // owner_name_raw(永久担当) はプロテクトと独立のため触らない(migration 59 と整合)。
      if (uid) {
        // プロテクト者を設定 → 解除マーカーはクリア。
        cleaned.protect_by_user_id = uid;
        cleaned.protect_released_at = null;
      } else {
        // プロテクト解除 → 期限をクリアし解除日時を記録。
        cleaned.protect_by_user_id = null;
        cleaned.protect_expires_at = null;
        cleaned.protect_released_at = new Date().toISOString();
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

/** 定期連絡者を自分に割り当てられるロール(viewer は不可)。 */
const REGULAR_CONTACT_ASSIGNABLE_ROLES = ['admin', 'manager', 'sales', 'support'];

/**
 * 定期連絡者を「自分」にトグル設定する。
 * - 既に自分が担当 → 解除、そうでなければ自分を担当に設定(引き継ぎ)。
 * - RLS(members_update) は自分所有の会員しか更新できないため、
 *   SECURITY DEFINER 関数 toggle_regular_contact_self 経由で更新する(migration 53)。
 * @returns assigned: 設定後に自分が担当なら true / 解除なら false
 */
export async function toggleRegularContactSelf(
  memberId: string,
): Promise<{ error?: string; assigned?: boolean }> {
  const me = await getCurrentUser();
  if (!REGULAR_CONTACT_ASSIGNABLE_ROLES.includes(me.role)) {
    return { error: '定期連絡者の割り当て権限がありません' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('toggle_regular_contact_self', {
    p_member_id: memberId,
  });

  if (error) {
    // migration 53 未適用(関数なし)などのケース
    return { error: `定期連絡者の更新に失敗しました: ${error.message}` };
  }

  revalidatePath(`/members/${memberId}`);
  revalidatePath('/members');
  revalidatePath('/');
  return { assigned: (data as string | null) === me.id };
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
