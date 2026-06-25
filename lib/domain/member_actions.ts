'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

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
}

export async function updateMember(
  input: UpdateMemberInput,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { id, ...fields } = input;

  // 空文字は null に変換
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'string') {
      cleaned[k] = v.trim() === '' ? null : v.trim();
    } else {
      cleaned[k] = v;
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
