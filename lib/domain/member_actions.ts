'use server';

import { getCurrentUser } from '@/lib/domain/auth';
import { mergeMemberExtra } from '@/lib/domain/member_extra_edit';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

/**
 * 会員詳細で編集を許可する DB カラムのホワイトリスト。
 * 動的編集フォーム(詳細フィールド全項目)から任意カラムが送られても、
 * ここに無いカラムは無視する(id / owner_id / protect_* / 監査系 / extra は対象外)。
 * ※ extra jsonb(累計入金額・各案件利用額など CSV取込管理項目)は本フォーム対象外。
 */
const EDITABLE_MEMBER_COLUMNS = new Set<string>([
  'name',
  'name_kana',
  'real_name',
  'email1',
  'email2',
  'email3',
  'phone1',
  'do_not_call',
  'address',
  'postal_code',
  'customer_type',
  'owner_name_raw',
  'gender',
  'birthdate',
  'referrer_name',
  'ad_id',
  'ad_medium',
  'info_acquired_points',
  'info_acquired_date',
  'first_contact_date',
  'mailmag_registered_at',
  'registered_at',
  'affiliate_id',
  'affiliate_name',
  'total_amount',
  'total_paid_amount',
  'total_used_amount',
  'xels_insider_joined_at',
  'sct_insider_joined_at',
  'regular_contact_id',
  'remarks',
]);

/**
 * 会員情報を更新する。
 * fields は詳細フィールド由来の任意カラムを受け取るが、EDITABLE_MEMBER_COLUMNS のみ反映する。
 */
export interface UpdateMemberInput {
  id: string;
  /** プロテクト者(担当)の users.id。空文字/null で解除。admin のみ変更可。 */
  protect_by_user_id?: string | null;
  /** プロテクト期限 (YYYY-MM-DD または ISO)。空文字/null で無期限解除。admin のみ変更可。 */
  protect_expires_at?: string | null;
  /**
   * extra(jsonb)のうち編集を許可するキー(電話番号2・3。EDITABLE_MEMBER_EXTRA_KEYS)の値。
   * 空文字/null でそのキーを削除。他のキーは触らない。
   */
  extra?: Record<string, string | null | undefined>;
  /** その他の会員カラム(ホワイトリストで検証)。 */
  [key: string]: unknown;
}

export async function updateMember(input: UpdateMemberInput): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { id, protect_by_user_id, protect_expires_at, extra: extraEdits, ...fields } = input;
  const hasProtectFields = 'protect_by_user_id' in input || 'protect_expires_at' in input;

  // ホワイトリストのカラムのみ反映。空文字は null に変換。
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!EDITABLE_MEMBER_COLUMNS.has(k)) continue; // 許可外カラムは無視
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

  // --- extra(jsonb)の許可キー(電話番号2・3)は、現在の extra に差し込んで丸ごと書き戻す ---
  // (他のキー(累計入金額・各案件利用額など)を壊さないため、ホワイトリストのキーだけ差し替える)
  if (extraEdits && Object.keys(extraEdits).length > 0) {
    const { data: current, error: readError } = await supabase
      .from('members')
      .select('extra')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();
    if (readError) return { error: readError.message };
    if (!current) return { error: '会員が見つかりません' };
    cleaned.extra = mergeMemberExtra(
      (current.extra as Record<string, unknown> | null) ?? null,
      extraEdits,
    );
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

/** 備考の最大文字数 (フリーテキストの想定外肥大を防ぐ) */
const REMARKS_MAX_LENGTH = 5000;

/**
 * 会員の備考 (remarks) を更新する。全ロールが編集可能 (migration 71)。
 * members_update ポリシーに阻まれないよう SECURITY DEFINER RPC を使う
 * (toggle_regular_contact_self と同方式。列を remarks に限定するため安全)。
 */
export async function updateMemberRemarks(
  memberId: string,
  remarks: string,
): Promise<{ error?: string }> {
  await getCurrentUser(); // 未ログインなら throw

  if (remarks.length > REMARKS_MAX_LENGTH) {
    return { error: `備考は${REMARKS_MAX_LENGTH}文字以内で入力してください` };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('update_member_remarks', {
    p_member_id: memberId,
    p_remarks: remarks,
  });

  if (error) {
    // migration 71 未適用(関数なし)などのケース
    return { error: `備考の更新に失敗しました: ${error.message}` };
  }

  revalidatePath(`/members/${memberId}`);
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

  // RLS の想定外挙動で通常 UPDATE では deleted_at セットが拒否されるため、
  // SECURITY DEFINER の RPC(soft_delete_member)経由で確実に論理削除する(migration 67)。
  const supabase = await createClient();
  const { error } = await supabase.rpc('soft_delete_member', { p_id: id });

  if (error) return { error: error.message };

  revalidatePath('/members');
  return {};
}

/**
 * 会員の新規登録(会員一覧の「新規登録」。CLAUDE.md §8.1 / §5.16「会員IDの採番」)。
 * 問合せを経由せずに会員を作る。ID は DB の連番 gen_member_id()(K- 形式)。viewer は不可。
 * 同じメール(email1〜3)または電話(phone1)の会員が既にあるときは、allowDuplicate が true でなければ
 * 登録せずに候補を返す(重複登録の防止。画面で確認してから登録し直せる)。
 */
export interface CreateMemberInput {
  name: string;
  name_kana?: string | null;
  email1?: string | null;
  phone1?: string | null;
  postal_code?: string | null;
  address?: string | null;
  ad_id?: string | null;
  ad_medium?: string | null;
  info_acquired_points?: string | null;
  info_acquired_date?: string | null;
  mailmag_registered_at?: string | null;
  /** 担当(users.id)。未指定なら実行者 */
  owner_id?: string | null;
  allowDuplicate?: boolean;
}

export interface CreateMemberResult {
  ok: boolean;
  id?: string;
  error?: string;
  /** 同じメール/電話の既存会員(重複の可能性)。これがあるときは登録していない */
  duplicates?: Array<{
    id: string;
    name: string | null;
    email1: string | null;
    phone1: string | null;
  }>;
}

export async function createMember(input: CreateMemberInput): Promise<CreateMemberResult> {
  const me = await getCurrentUser();
  if (me.role === 'viewer') return { ok: false, error: '閲覧専用ユーザーは登録できません' };
  const nz = (v: string | null | undefined, max = 200) => {
    const s = (v ?? '').trim();
    return s ? s.slice(0, max) : null;
  };
  const name = nz(input.name);
  if (!name) return { ok: false, error: '氏名を入力してください' };
  const email1 = nz(input.email1)?.toLowerCase() ?? null;
  const phone1 = nz(input.phone1, 50);
  const infoDate = nz(input.info_acquired_date, 10);
  if (infoDate && !/^\d{4}-\d{2}-\d{2}$/.test(infoDate)) {
    return { ok: false, error: '顧客情報取得日は YYYY-MM-DD 形式で指定してください' };
  }
  const mailmag = nz(input.mailmag_registered_at, 40);
  const mailmagIso = mailmag ? new Date(mailmag) : null;
  if (mailmagIso && Number.isNaN(mailmagIso.getTime())) {
    return { ok: false, error: 'メルマガ登録日時の形式が不正です' };
  }

  const supabase = await createClient();

  // 重複の確認(メール・電話の完全一致。あいまい一致はしない)
  if (!input.allowDuplicate && (email1 || phone1)) {
    const ors: string[] = [];
    if (email1) {
      const e = email1.replace(/[%_,]/g, '');
      ors.push(`email1.ilike.${e}`, `email2.ilike.${e}`, `email3.ilike.${e}`);
    }
    if (phone1) ors.push(`phone1.eq.${phone1.replace(/[^0-9+-]/g, '')}`);
    const { data: dups } = await supabase
      .from('members')
      .select('id, name, email1, phone1')
      .is('deleted_at', null)
      .or(ors.join(','))
      .limit(5);
    const list = (dups ?? []) as CreateMemberResult['duplicates'];
    if (list && list.length > 0) {
      return { ok: false, error: '同じメールまたは電話番号の会員が既にあります', duplicates: list };
    }
  }

  // ID 採番(連番。migration 86)
  const { data: newId, error: idErr } = await supabase.rpc('gen_member_id');
  if (idErr || typeof newId !== 'string' || !/^K-\d{9}$/.test(newId)) {
    return { ok: false, error: `会員IDの採番に失敗しました: ${idErr?.message ?? ''}` };
  }

  const ownerId = nz(input.owner_id, 64) ?? me.id;
  const { error } = await supabase.from('members').insert({
    id: newId,
    name,
    name_kana: nz(input.name_kana),
    email1,
    phone1,
    postal_code: nz(input.postal_code, 20),
    address: nz(input.address, 500),
    ad_id: nz(input.ad_id, 50),
    ad_medium: nz(input.ad_medium),
    info_acquired_points: nz(input.info_acquired_points),
    info_acquired_date: infoDate,
    mailmag_registered_at: mailmagIso ? mailmagIso.toISOString() : null,
    owner_id: ownerId,
    registered_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: `登録に失敗しました: ${error.message}` };
  revalidatePath('/members');
  return { ok: true, id: newId };
}
