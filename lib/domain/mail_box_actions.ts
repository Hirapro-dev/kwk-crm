'use server';

/**
 * 受信箱(mail_boxes)と送信ドメインの管理者向け Server Actions。CLAUDE.md §5.15 M2。
 * `/mail/settings`(admin のみ)から呼ぶ。RLS(migration 76: mail_boxes の書込は admin のみ)と二重に確認する。
 *
 * - 受信箱の追加・編集(表示名・既定の署名・有効/無効)。削除はしない(スレッドが参照するため無効化で代替)
 *   署名の本文は署名マスタ(mail_signature_actions.ts / migration 105)で管理し、受信箱は「どれを既定にするか」だけ持つ
 * - 送信ドメインの SES 登録(Easy DKIM)。DNS への CNAME 追加は画面の案内に従って手作業
 */

import { getCurrentUser } from '@/lib/domain/auth';
import { normalizeMailBoxAddress } from '@/lib/domain/mail_box_settings';
import { sanitizeDisplayName } from '@/lib/domain/mail_compose';
import { getMailAwsConfig } from '@/lib/mail/aws';
import { type DomainIdentity, registerDomainIdentity } from '@/lib/mail/ses_identity';
import { clearSendableCache } from '@/lib/mail/ses_send';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export interface MailBoxActionResult {
  error?: string;
}

/**
 * 「その他」(未登録アドレス宛)に溜まっているスレッドのうち、追加した受信箱のアドレス宛で、
 * 有効な受信箱に一意に一致するものをその受信箱へ移す(migration 106 の受信箱単位 RPC)。
 * 全件走査の RPC(migration 78/83)は「その他」が約 6 万スレッドあると 8 秒の statement_timeout で
 * 止まり、登録前に届いたメールが残ったままになっていた(2026-09-18)。受信箱単位なら宛先の
 * インデックスで引くため速い。失敗しても登録自体は成功しているので止めず、件数だけ返す。
 */
async function reassignOtherMailThreadsForBox(
  supabase: Awaited<ReturnType<typeof createClient>>,
  boxId: number,
): Promise<number | null> {
  const { data, error } = await supabase.rpc('reassign_other_mail_threads_for_box', {
    p_box_id: boxId,
  });
  if (error) return null;
  return (data as number | null) ?? 0;
}

async function requireAdmin(): Promise<string | null> {
  const me = await getCurrentUser();
  return me.role === 'admin' ? null : '管理者のみ変更できます';
}

/** 受信箱を追加する。アドレスは小文字化して保存(受信時の宛先判定キー) */
export async function createMailBox(input: {
  address: string;
  displayName?: string | null;
}): Promise<MailBoxActionResult & { moved?: number | null }> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };

  const addr = normalizeMailBoxAddress(input.address);
  if (addr.error) return { error: addr.error };

  const supabase = await createClient();
  const { data: created, error } = await supabase
    .from('mail_boxes')
    .insert({
      address: addr.address,
      display_name: sanitizeDisplayName(input.displayName),
      is_active: true,
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') return { error: `${addr.address} は既に登録されています` };
    return { error: `登録に失敗しました: ${error.message}` };
  }

  // 登録直後に「その他」フォルダを見て、このアドレス宛のメールがあれば自動で移す
  const moved = await reassignOtherMailThreadsForBox(supabase, (created as { id: number }).id);

  revalidatePath('/mail/settings');
  revalidatePath('/mail');
  return { moved };
}

/** 受信箱の表示名・既定の署名・有効/無効を更新する(アドレスは変更しない) */
export async function updateMailBox(input: {
  id: number;
  displayName?: string | null;
  /** 既定の署名(mail_signatures.id)。null で「署名なし」 */
  defaultSignatureId?: number | null;
  isActive?: boolean;
}): Promise<MailBoxActionResult> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };
  if (!Number.isInteger(input.id) || input.id <= 0) return { error: '受信箱が指定されていません' };

  const patch: Record<string, unknown> = {};
  if (input.displayName !== undefined) patch.display_name = sanitizeDisplayName(input.displayName);
  if (input.defaultSignatureId !== undefined) {
    const sid = input.defaultSignatureId;
    if (sid !== null && (!Number.isInteger(sid) || sid <= 0))
      return { error: '署名の指定が不正です' };
    patch.default_signature_id = sid;
  }
  if (input.isActive !== undefined) patch.is_active = input.isActive;
  if (Object.keys(patch).length === 0) return {};

  const supabase = await createClient();
  const { error } = await supabase.from('mail_boxes').update(patch).eq('id', input.id);
  if (error) return { error: `更新に失敗しました: ${error.message}` };

  revalidatePath('/mail/settings');
  revalidatePath('/mail');
  return {};
}

/**
 * 送信ドメインを SES に登録する(Easy DKIM)。戻り値の dkimTokens から
 * 画面が DNS に貼る CNAME 3本を組み立てて表示する。
 */
export async function registerMailDomain(
  domain: string,
): Promise<MailBoxActionResult & { identity?: DomainIdentity }> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };

  const d = (domain ?? '').trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return { error: 'ドメインの形式が不正です' };

  const cfg = getMailAwsConfig();
  if (!cfg) return { error: '送信基盤(SES)が未設定です' };

  try {
    const identity = await registerDomainIdentity(cfg, d);
    revalidatePath('/mail/settings');
    return { identity };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** SES の検証状態のキャッシュを捨てて再確認する(DNS を貼った直後に押す用) */
export async function recheckMailDomains(): Promise<MailBoxActionResult> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };
  clearSendableCache();
  revalidatePath('/mail/settings');
  revalidatePath('/mail');
  return {};
}

const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T00:00:00Z$/;

/**
 * 「その他」フォルダの再振り分けを、指定した期間(last_message_at)について手動で実行する。
 * 画面(ReassignOtherButton)が `reassignRanges()` の期間を順に渡す(1 回 = 1 期間)。
 * 全件を 1 回の RPC で行うと約 6 万スレッドの走査で statement_timeout(8 秒)に掛かるため
 * (2026-09-18)、migration 83 の範囲指定関数を期間ごとに呼ぶ。この関数は authenticated から
 * 呼べない(SQL Editor / サービスロール専用)ので、admin を確認したうえでサービスロールで呼ぶ。
 * 移動できた件数を返す。
 */
export async function reassignOtherMailThreadsRange(input: {
  from: string;
  to: string;
}): Promise<MailBoxActionResult & { moved?: number }> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };
  if (!ISO_UTC_RE.test(input.from) || !ISO_UTC_RE.test(input.to) || input.from >= input.to) {
    return { error: '期間の指定が不正です' };
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc('reassign_other_mail_threads_range', {
    p_from: input.from,
    p_to: input.to,
  });
  if (error) return { error: `再振り分けに失敗しました: ${error.message}` };

  revalidatePath('/mail/settings');
  revalidatePath('/mail');
  return { moved: (data as number | null) ?? 0 };
}
