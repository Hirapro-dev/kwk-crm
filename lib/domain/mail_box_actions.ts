'use server';

/**
 * 受信箱(mail_boxes)と送信ドメインの管理者向け Server Actions。CLAUDE.md §5.15 M2。
 * `/settings/mail`(admin のみ)から呼ぶ。RLS(migration 76: mail_boxes の書込は admin のみ)と二重に確認する。
 *
 * - 受信箱の追加・編集(表示名・署名・有効/無効)。削除はしない(スレッドが参照するため無効化で代替)
 * - 送信ドメインの SES 登録(Easy DKIM)。DNS への CNAME 追加は画面の案内に従って手作業
 */

import { getCurrentUser } from '@/lib/domain/auth';
import { normalizeMailBoxAddress } from '@/lib/domain/mail_box_settings';
import { sanitizeDisplayName } from '@/lib/domain/mail_compose';
import { getMailAwsConfig } from '@/lib/mail/aws';
import { type DomainIdentity, registerDomainIdentity } from '@/lib/mail/ses_identity';
import { clearSendableCache } from '@/lib/mail/ses_send';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export interface MailBoxActionResult {
  error?: string;
}

/** 署名の上限(誤って巨大なテキストを保存しないための安全弁) */
const MAX_SIGNATURE_CHARS = 2_000;

async function requireAdmin(): Promise<string | null> {
  const me = await getCurrentUser();
  return me.role === 'admin' ? null : '管理者のみ変更できます';
}

function normalizeSignature(input: string | null | undefined): string | null {
  const s = (input ?? '').replace(/\r\n/g, '\n').trim();
  if (!s) return null;
  return s.slice(0, MAX_SIGNATURE_CHARS);
}

/** 受信箱を追加する。アドレスは小文字化して保存(受信時の宛先判定キー) */
export async function createMailBox(input: {
  address: string;
  displayName?: string | null;
  signature?: string | null;
}): Promise<MailBoxActionResult> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };

  const addr = normalizeMailBoxAddress(input.address);
  if (addr.error) return { error: addr.error };

  const supabase = await createClient();
  const { error } = await supabase.from('mail_boxes').insert({
    address: addr.address,
    display_name: sanitizeDisplayName(input.displayName),
    signature: normalizeSignature(input.signature),
    is_active: true,
  });
  if (error) {
    if (error.code === '23505') return { error: `${addr.address} は既に登録されています` };
    return { error: `登録に失敗しました: ${error.message}` };
  }

  revalidatePath('/settings/mail');
  revalidatePath('/mail');
  return {};
}

/** 受信箱の表示名・署名・有効/無効を更新する(アドレスは変更しない) */
export async function updateMailBox(input: {
  id: number;
  displayName?: string | null;
  signature?: string | null;
  isActive?: boolean;
}): Promise<MailBoxActionResult> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };
  if (!Number.isInteger(input.id) || input.id <= 0) return { error: '受信箱が指定されていません' };

  const patch: Record<string, unknown> = {};
  if (input.displayName !== undefined) patch.display_name = sanitizeDisplayName(input.displayName);
  if (input.signature !== undefined) patch.signature = normalizeSignature(input.signature);
  if (input.isActive !== undefined) patch.is_active = input.isActive;
  if (Object.keys(patch).length === 0) return {};

  const supabase = await createClient();
  const { error } = await supabase.from('mail_boxes').update(patch).eq('id', input.id);
  if (error) return { error: `更新に失敗しました: ${error.message}` };

  revalidatePath('/settings/mail');
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
    revalidatePath('/settings/mail');
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
  revalidatePath('/settings/mail');
  revalidatePath('/mail');
  return {};
}
