'use server';

/**
 * 署名マスタ(mail_signatures)の管理者向け Server Actions。CLAUDE.md §5.15「署名」/ migration 105。
 * `/mail/settings`(admin のみ)から呼ぶ。RLS(mail_signatures の書込は admin のみ)と二重に確認する。
 *
 * - 署名の追加・編集(名前・本文・有効/無効)。削除はしない(受信箱の既定署名が参照するため無効化で代替)
 * - 受信箱への紐付け(既定の署名)は mail_box_actions.ts の updateMailBox
 */

import { getCurrentUser } from '@/lib/domain/auth';
import { normalizeSignatureBody, normalizeSignatureName } from '@/lib/domain/mail_signatures';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export interface MailSignatureActionResult {
  error?: string;
}

async function requireAdmin(): Promise<string | null> {
  const me = await getCurrentUser();
  return me.role === 'admin' ? null : '管理者のみ変更できます';
}

function revalidate() {
  revalidatePath('/mail/settings');
  revalidatePath('/mail');
  revalidatePath('/mail/new');
}

/** 署名を追加する */
export async function createMailSignature(input: {
  name: string;
  body: string;
}): Promise<MailSignatureActionResult & { id?: number }> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };

  const name = normalizeSignatureName(input.name);
  if (!name) return { error: '署名名を入力してください' };
  const body = normalizeSignatureBody(input.body);
  if (!body) return { error: '署名の本文を入力してください' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('mail_signatures')
    .insert({ name, body, is_active: true })
    .select('id')
    .single();
  if (error) return { error: `登録に失敗しました: ${error.message}` };

  revalidate();
  return { id: (data as { id: number }).id };
}

/** 署名の名前・本文・有効/無効を更新する */
export async function updateMailSignature(input: {
  id: number;
  name?: string;
  body?: string;
  isActive?: boolean;
}): Promise<MailSignatureActionResult> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };
  if (!Number.isInteger(input.id) || input.id <= 0) return { error: '署名が指定されていません' };

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = normalizeSignatureName(input.name);
    if (!name) return { error: '署名名を入力してください' };
    patch.name = name;
  }
  if (input.body !== undefined) {
    const body = normalizeSignatureBody(input.body);
    if (!body) return { error: '署名の本文を入力してください' };
    patch.body = body;
  }
  if (input.isActive !== undefined) patch.is_active = input.isActive;
  if (Object.keys(patch).length === 0) return {};

  const supabase = await createClient();
  const { error } = await supabase.from('mail_signatures').update(patch).eq('id', input.id);
  if (error) return { error: `更新に失敗しました: ${error.message}` };

  revalidate();
  return {};
}
