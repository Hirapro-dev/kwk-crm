'use server';

/**
 * メール取込ルール(mail_import_rules)の Server Actions。CLAUDE.md §5.16。
 * 取込候補のメール詳細の「取込ルール」パネル(新規作成・編集)と、/mail/settings の一覧
 * (有効/無効・判定順・削除)から呼ぶ。admin のみ(RLS と二重に確認)。
 */

import { getCurrentUser } from '@/lib/domain/auth';
import {
  FORM_NAME_SOURCES,
  type FormNameSource,
  normalizeFieldMap,
} from '@/lib/domain/mail_import_rules';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export interface MailImportRuleActionResult {
  error?: string;
  id?: number;
}

export interface SaveMailImportRuleInput {
  id?: number;
  name: string;
  isActive?: boolean;
  mailBoxId: number | null;
  fromAddress: string | null;
  subjectContains: string | null;
  /** 本文に含むキーワード(空白区切り。migration 90) */
  bodyContains?: string | null;
  formNameSource: string;
  formNameParam: string | null;
  fieldMap: Record<string, string>;
}

const MAX_NAME = 100;
const MAX_TEXT = 300;

async function requireAdmin(): Promise<string | null> {
  const me = await getCurrentUser();
  return me.role === 'admin' ? null : '管理者のみ変更できます';
}

function trimOrNull(v: string | null | undefined, max = MAX_TEXT): string | null {
  const s = (v ?? '').trim();
  return s ? s.slice(0, max) : null;
}

function revalidate() {
  revalidatePath('/mail', 'layout');
  revalidatePath('/mail/settings');
}

/** ルールを追加(id 無し)または更新(id あり)する */
export async function saveMailImportRule(
  input: SaveMailImportRuleInput,
): Promise<MailImportRuleActionResult> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };

  const name = (input.name ?? '').trim();
  if (!name) return { error: 'ルール名を入力してください' };
  if (!FORM_NAME_SOURCES.includes(input.formNameSource as FormNameSource)) {
    return { error: 'フォーム名の取り方が不正です' };
  }
  const source = input.formNameSource as FormNameSource;
  const param = trimOrNull(input.formNameParam);
  if (source === 'body_line' && !(param && /^\d+$/.test(param) && Number(param) >= 1)) {
    return { error: '本文の行番号(1以上の整数)を指定してください' };
  }
  if ((source === 'body_label' || source === 'fixed') && !param) {
    return {
      error: source === 'body_label' ? 'ラベルを指定してください' : 'フォーム名を入力してください',
    };
  }
  const fieldMap = normalizeFieldMap(input.fieldMap);
  const mailBoxId =
    input.mailBoxId !== null && Number.isInteger(input.mailBoxId) && input.mailBoxId > 0
      ? input.mailBoxId
      : null;

  const row = {
    name: name.slice(0, MAX_NAME),
    is_active: input.isActive ?? true,
    mail_box_id: mailBoxId,
    from_address: trimOrNull(input.fromAddress)?.toLowerCase() ?? null,
    subject_contains: trimOrNull(input.subjectContains),
    body_contains: trimOrNull(input.bodyContains),
    form_name_source: source,
    form_name_param: source === 'subject' || source === 'subject_without_name' ? null : param,
    field_map: fieldMap,
  };

  const supabase = await createClient();
  if (input.id) {
    const { error } = await supabase
      .from('mail_import_rules')
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq('id', input.id);
    if (error) return { error: `ルールの更新に失敗しました: ${error.message}` };
    revalidate();
    return { id: input.id };
  }
  const { data, error } = await supabase
    .from('mail_import_rules')
    .insert(row)
    .select('id')
    .single();
  if (error) return { error: `ルールの追加に失敗しました: ${error.message}` };
  revalidate();
  return { id: (data as { id: number }).id };
}

export async function setMailImportRuleActive(
  id: number,
  isActive: boolean,
): Promise<MailImportRuleActionResult> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };
  const supabase = await createClient();
  const { error } = await supabase
    .from('mail_import_rules')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { error: `更新に失敗しました: ${error.message}` };
  revalidate();
  return { id };
}

/** 判定順を1つ上げる/下げる(隣のルールと sort_order を入れ替える) */
export async function moveMailImportRule(
  id: number,
  direction: 'up' | 'down',
): Promise<MailImportRuleActionResult> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('mail_import_rules')
    .select('id, sort_order')
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });
  if (error) return { error: `取得に失敗しました: ${error.message}` };
  const rows = (data ?? []) as Array<{ id: number; sort_order: number }>;
  const idx = rows.findIndex((r) => r.id === id);
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (idx < 0 || swapIdx < 0 || swapIdx >= rows.length) return { id };
  // 同じ sort_order 同士だと入れ替えても順が変わらないため、位置に応じた値を振り直す
  const a = rows[idx] as { id: number; sort_order: number };
  const b = rows[swapIdx] as { id: number; sort_order: number };
  const aOrder = (swapIdx + 1) * 10;
  const bOrder = (idx + 1) * 10;
  const r1 = await supabase.from('mail_import_rules').update({ sort_order: aOrder }).eq('id', a.id);
  if (r1.error) return { error: `更新に失敗しました: ${r1.error.message}` };
  const r2 = await supabase.from('mail_import_rules').update({ sort_order: bOrder }).eq('id', b.id);
  if (r2.error) return { error: `更新に失敗しました: ${r2.error.message}` };
  revalidate();
  return { id };
}

export async function deleteMailImportRule(id: number): Promise<MailImportRuleActionResult> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };
  const supabase = await createClient();
  const { error } = await supabase.from('mail_import_rules').delete().eq('id', id);
  if (error) return { error: `削除に失敗しました: ${error.message}` };
  revalidate();
  return { id };
}
