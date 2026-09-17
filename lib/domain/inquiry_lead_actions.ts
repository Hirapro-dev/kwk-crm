'use server';

/**
 * 問合せ一覧のリード操作(CLAUDE.md §5.16 段階④)の Server Actions。
 * - getInquiryMatchCandidates: 会員の照合候補(DB 関数 match_members_for_inquiry で点数を出し直す)
 * - searchMembersForInquiry: 氏名・カナ・メール・電話・会員IDでの手動検索
 * - linkInquiryToMember / createMemberFromInquiry: 既存の会員化(convertInquiryToMember)を流用し、
 *   照合結果を「確認済み(manual)」にする
 * - markInquiryReviewed: 会員を作らずに「確認済み」にする
 * 権限は会員化と同じ(viewer 不可。RLS は実行ユーザーで適用)。
 */

import { getCurrentUser } from '@/lib/domain/auth';
import { type ConvertMemberFields, convertInquiryToMember } from '@/lib/domain/inquiry_actions';
import {
  type InquiryOverrides,
  type MemberMatch,
  inquiryOverridesForMember,
} from '@/lib/domain/inquiry_lead';
import { normalizeMatchInput } from '@/lib/domain/mail_import_match';
import { listAcquisitionPoints } from '@/lib/domain/masters';
import { type UpdateMemberInput, updateMember } from '@/lib/domain/member_actions';
import { getMember } from '@/lib/domain/members';
import { type FieldDefinition, getVisibleFields } from '@/lib/domain/object_metadata';
import type { MemberWithOwner } from '@/lib/domain/types';
import { listAllUsers } from '@/lib/domain/users_admin';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export interface MemberBrief {
  id: string;
  name: string | null;
  email1: string | null;
  phone1: string | null;
  address: string | null;
}

export interface MatchCandidate extends MemberBrief {
  points: number;
  matched: string[];
}

async function requireWriter(): Promise<string | null> {
  const me = await getCurrentUser();
  return me.role === 'viewer' ? '閲覧専用ロールでは操作できません' : null;
}

function revalidate(inquiryId: string) {
  revalidatePath('/inquiries');
  revalidatePath(`/inquiries/${inquiryId}`);
}

/** 問合せの氏名・電話・メール・住所で既存会員を照合し、候補を点数順に返す */
export async function getInquiryMatchCandidates(
  inquiryId: string,
): Promise<{ error?: string; candidates?: MatchCandidate[] }> {
  await getCurrentUser();
  const supabase = await createClient();
  const { data: inq, error } = await supabase
    .from('inquiries')
    .select('name, phone, email, address')
    .eq('id', inquiryId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error || !inq) return { error: '問合せが見つかりません' };
  const norm = normalizeMatchInput(
    inq as {
      name: string | null;
      phone: string | null;
      email: string | null;
      address: string | null;
    },
  );
  if (!norm.name && !norm.phone && !norm.email && !norm.address) return { candidates: [] };

  const { data: rows, error: rpcErr } = await supabase.rpc('match_members_for_inquiry', {
    p_name: norm.name,
    p_phone: norm.phone,
    p_email: norm.email,
    p_address: norm.address,
  });
  if (rpcErr) return { error: `照合に失敗しました: ${rpcErr.message}` };
  const scored = (rows ?? []) as Array<{ member_id: string; points: number; matched: string[] }>;
  if (scored.length === 0) return { candidates: [] };

  const { data: members } = await supabase
    .from('members')
    .select('id, name, email1, phone1, address')
    .in(
      'id',
      scored.map((r) => r.member_id),
    )
    .is('deleted_at', null);
  const byId = new Map(((members ?? []) as MemberBrief[]).map((m) => [m.id, m]));
  return {
    candidates: scored
      .filter((r) => byId.has(r.member_id))
      .map((r) => ({
        ...(byId.get(r.member_id) as MemberBrief),
        points: r.points,
        matched: r.matched,
      })),
  };
}

/** 会員の手動検索(氏名・カナ・メール・電話・会員IDの部分一致。最大 20 件) */
export async function searchMembersForInquiry(
  q: string,
): Promise<{ error?: string; members?: MemberBrief[] }> {
  await getCurrentUser();
  const raw = (q ?? '').trim();
  if (!raw) return { members: [] };
  const safe = raw.replace(/[%_]/g, '\\$&');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('members')
    .select('id, name, email1, phone1, address')
    .is('deleted_at', null)
    .or(
      `name.ilike.%${safe}%,name_kana.ilike.%${safe}%,email1.ilike.%${safe}%,phone1.ilike.%${safe}%,id.ilike.%${safe}%`,
    )
    .order('id', { ascending: false })
    .limit(20);
  if (error) return { error: `検索に失敗しました: ${error.message}` };
  return { members: (data ?? []) as MemberBrief[] };
}

async function setMatchReviewed(inquiryId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('inquiries')
    .select('member_match')
    .eq('id', inquiryId)
    .maybeSingle();
  const current = ((data as { member_match: MemberMatch | null } | null)?.member_match ??
    null) as MemberMatch | null;
  const next: MemberMatch = {
    status: 'manual',
    points: current?.points ?? 0,
    candidates: current?.candidates ?? [],
    checked_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('inquiries')
    .update({ member_match: next })
    .eq('id', inquiryId);
  return error ? error.message : null;
}

/** 既存会員に紐付ける(会員化)。照合結果は「確認済み」にする */
/**
 * 「この会員に紐付け」の前に、会員の編集フォームに必要なものをまとめて返す(2026-09-17)。
 * 会員の現在値・詳細項目の定義・担当者候補・取得ポイントの選択肢と、問合せの値を空欄に差し込む初期値
 * (純粋関数 inquiryOverridesForMember)。
 */
export async function loadMemberForLink(
  inquiryId: string,
  memberId: string,
): Promise<{
  error?: string;
  member?: MemberWithOwner;
  detailFields?: FieldDefinition[];
  users?: Array<{ id: string; full_name: string | null }>;
  acquisitionPoints?: string[];
  overrides?: InquiryOverrides;
}> {
  const denied = await requireWriter();
  if (denied) return { error: denied };
  const supabase = await createClient();
  const [member, detailFields, users, points, inquiryRes] = await Promise.all([
    getMember(memberId),
    getVisibleFields('members', 'detail'),
    listAllUsers({ activeOnly: true }),
    listAcquisitionPoints({ activeOnly: true }),
    supabase
      .from('inquiries')
      .select('name_kana, email, phone, postal_code, address, ad_id')
      .eq('id', inquiryId)
      .is('deleted_at', null)
      .maybeSingle(),
  ]);
  if (!member) return { error: '会員が見つかりません' };
  if (inquiryRes.error || !inquiryRes.data) return { error: '問合せが見つかりません' };
  const inq = inquiryRes.data as {
    name_kana: string | null;
    email: string | null;
    phone: string | null;
    postal_code: string | null;
    address: string | null;
    ad_id: string | null;
  };
  const overrides = inquiryOverridesForMember(inq, {
    name_kana: member.name_kana,
    email1: member.email1,
    email2: member.email2,
    email3: member.email3,
    phone1: member.phone1,
    postal_code: member.postal_code,
    address: member.address,
    ad_id: member.ad_id,
    extra: (member as unknown as { extra?: Record<string, unknown> | null }).extra,
  });
  return {
    member,
    detailFields,
    users: users.map((u) => ({ id: u.id, full_name: u.full_name })),
    acquisitionPoints: points.map((p) => p.name),
    overrides,
  };
}

/**
 * 既存会員に紐付ける。memberPatch があれば先に会員情報を更新する(会員の編集フォームで確認した値。
 * updateMember と同じホワイトリスト・権限)。更新に失敗したら紐付けもしない。
 */
export async function linkInquiryToMember(
  inquiryId: string,
  memberId: string,
  memberPatch?: UpdateMemberInput,
): Promise<{ error?: string; memberId?: string }> {
  const denied = await requireWriter();
  if (denied) return { error: denied };
  if (memberPatch) {
    if (memberPatch.id !== memberId) return { error: '会員IDが一致しません' };
    const upd = await updateMember(memberPatch);
    if (upd.error) return { error: `会員情報の更新に失敗しました: ${upd.error}` };
  }
  const res = await convertInquiryToMember({
    inquiry_id: inquiryId,
    existing_member_id: memberId,
  });
  if (!res.ok) return { error: res.error ?? '紐付けに失敗しました' };
  await setMatchReviewed(inquiryId);
  revalidate(inquiryId);
  return { memberId: res.memberId };
}

/** 新規会員を作って紐付ける(会員化。K- 採番)。照合結果は「確認済み」にする */
export async function createMemberFromInquiry(
  inquiryId: string,
  name: string,
  fields?: ConvertMemberFields,
): Promise<{ error?: string; memberId?: string }> {
  const denied = await requireWriter();
  if (denied) return { error: denied };
  const res = await convertInquiryToMember({
    inquiry_id: inquiryId,
    new_member_name: name,
    member_fields: fields,
  });
  if (!res.ok) return { error: res.error ?? '会員の作成に失敗しました' };
  await setMatchReviewed(inquiryId);
  revalidate(inquiryId);
  return { memberId: res.memberId };
}

/** 会員を作らずに「確認済み」にする(重複申請など、登録しないと判断したとき) */
export async function markInquiryReviewed(inquiryId: string): Promise<{ error?: string }> {
  const denied = await requireWriter();
  if (denied) return { error: denied };
  const err = await setMatchReviewed(inquiryId);
  if (err) return { error: `更新に失敗しました: ${err}` };
  revalidate(inquiryId);
  return {};
}
