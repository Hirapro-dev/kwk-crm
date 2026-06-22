'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from './auth';

/**
 * 問合せ → 会員化(仕様書 §8.1)。
 * 既存会員の選択 or 新規会員作成のどちらか。
 *
 * ID 採番方針(2026-05 変更):
 *   - 既存 CSV 由来データの ID(K-XXXXXXX) は維持
 *   - 本システム新規作成時は UUID 文字列を採番(衝突回避)
 */

const ConvertSchema = z
  .object({
    inquiry_id: z.string().min(1, '問合せIDが必要です'),
    /** 既存会員に紐づける場合(K- 形式 or UUID) */
    existing_member_id: z
      .string()
      .min(1)
      .optional()
      .or(z.literal('').transform(() => undefined)),
    /** 新規会員を作成する場合 */
    new_member_name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .or(z.literal('').transform(() => undefined)),
  })
  .refine(
    (v) => Boolean(v.existing_member_id) !== Boolean(v.new_member_name),
    '既存会員ID または 新規会員名 のどちらか一方を指定してください',
  );

export interface ConvertResult {
  ok: boolean;
  memberId?: string;
  error?: string;
}

/**
 * 新規会員ID を採番する。
 * UUID v4 を返す(衝突確率は実用上ゼロ)。
 */
function generateMemberId(): string {
  return randomUUID();
}

export async function convertInquiryToMember(input: {
  inquiry_id: string;
  existing_member_id?: string;
  new_member_name?: string;
}): Promise<ConvertResult> {
  const parsed = ConvertSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '入力エラー' };
  }
  const me = await getCurrentUser();
  if (me.role === 'viewer') {
    return { ok: false, error: '閲覧専用ロールでは操作できません' };
  }

  const supabase = await createClient();

  // 問合せの存在チェック
  const { data: inquiry, error: inqErr } = await supabase
    .from('inquiries')
    .select('id, member_id, name, email, phone, postal_code, address, ad_id')
    .eq('id', parsed.data.inquiry_id)
    .is('deleted_at', null)
    .maybeSingle();
  if (inqErr || !inquiry) {
    return { ok: false, error: '問合せが見つかりません' };
  }
  if (inquiry.member_id) {
    return { ok: false, error: 'この問合せは既に会員化済みです' };
  }

  let memberId: string;
  if (parsed.data.existing_member_id) {
    const { data: existing } = await supabase
      .from('members')
      .select('id')
      .eq('id', parsed.data.existing_member_id)
      .is('deleted_at', null)
      .maybeSingle();
    if (!existing) return { ok: false, error: '指定の会員が存在しません' };
    memberId = existing.id as string;
  } else {
    // 新規会員作成(UUID 採番)
    memberId = generateMemberId();
    const { error: insErr } = await supabase.from('members').insert({
      id: memberId,
      name: parsed.data.new_member_name!,
      email1: inquiry.email,
      phone1: inquiry.phone,
      postal_code: inquiry.postal_code,
      address: inquiry.address,
      ad_id: inquiry.ad_id,
      owner_id: me.id,
      registered_at: new Date().toISOString(),
    });
    if (insErr) {
      // UUID 衝突は実用上発生しないが、念のため1回 retry
      if (insErr.message.includes('duplicate')) {
        memberId = generateMemberId();
        const { error: retryErr } = await supabase.from('members').insert({
          id: memberId,
          name: parsed.data.new_member_name!,
          email1: inquiry.email,
          phone1: inquiry.phone,
          postal_code: inquiry.postal_code,
          address: inquiry.address,
          ad_id: inquiry.ad_id,
          owner_id: me.id,
          registered_at: new Date().toISOString(),
        });
        if (retryErr) return { ok: false, error: retryErr.message };
      } else {
        return { ok: false, error: insErr.message };
      }
    }
  }

  // 問合せに member_id を紐付け
  const { error: updErr } = await supabase
    .from('inquiries')
    .update({ member_id: memberId })
    .eq('id', parsed.data.inquiry_id);
  if (updErr) return { ok: false, error: updErr.message };

  revalidatePath(`/inquiries/${parsed.data.inquiry_id}`);
  revalidatePath('/inquiries');
  revalidatePath('/members');
  revalidatePath(`/members/${memberId}`);

  return { ok: true, memberId };
}
