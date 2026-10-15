'use server';

/**
 * 送信待ちメール(mail_outbox。migration 124)の承認・差し戻し・取消・修正・送り直し。CLAUDE.md §5.15。
 *
 * - 誰が何をできるかは純粋関数(mail_outbox.ts の canApproveOutbox など)で決める
 * - 状態の書き換えは「今の状態がこれなら」の条件付き UPDATE にして、同時操作で二重に進まないようにする
 * - 書込みはサービスロール(mail_outbox は RLS で書込みポリシーを設けていない)。権限の確認はここで行う
 */

import { getCurrentUser } from '@/lib/domain/auth';
import { MAX_RECIPIENTS, parseAddressList, sanitizeDisplayName } from '@/lib/domain/mail_compose';
import {
  MAX_REJECT_REASON_CHARS,
  type MailOutboxStatus,
  canApproveOutbox,
  canCancelOutbox,
  canEditOutbox,
  canRejectOutbox,
  canRetryOutbox,
  isDueNow,
  parseScheduledInput,
} from '@/lib/domain/mail_outbox';
import { getMailAwsConfig } from '@/lib/mail/aws';
import { deliverOutboxItem } from '@/lib/mail/outbox_deliver';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export interface OutboxActionResult {
  error?: string;
  message?: string;
  /** 送信したときのスレッド(新規メールはここで作られる) */
  threadId?: string | null;
}

interface OutboxCore {
  id: string;
  kind: 'reply' | 'new';
  status: MailOutboxStatus;
  created_by: string;
  scheduled_at: string | null;
  thread_id: string | null;
  to_addresses: string[];
}

async function loadCore(id: string): Promise<OutboxCore | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const admin = createServiceRoleClient();
  const { data } = await admin
    .from('mail_outbox')
    .select('id, kind, status, created_by, scheduled_at, thread_id, to_addresses')
    .eq('id', id)
    .maybeSingle();
  return (data as OutboxCore | null) ?? null;
}

function revalidate(item: OutboxCore, threadId?: string | null) {
  revalidatePath('/mail', 'layout');
  const t = threadId ?? item.thread_id;
  if (t) revalidatePath(`/mail/${t}`);
}

/** 承認待ち → 承認。予約なし(または予約日時を過ぎている)ならその場で送る */
export async function approveMailOutbox(id: string): Promise<OutboxActionResult> {
  const me = await getCurrentUser();
  const item = await loadCore(id);
  if (!item) return { error: '送信待ちのメールが見つかりません' };
  if (!canApproveOutbox(me, item)) {
    return {
      error:
        item.created_by === me.id
          ? '自分が作成したメールは承認できません(ほかの承認者が承認します)'
          : 'このメールは承認できません(承認者は admin / manager。承認待ちのものだけ承認できます)',
    };
  }

  const admin = createServiceRoleClient();
  const { data: updated, error } = await admin
    .from('mail_outbox')
    .update({
      status: 'approved',
      approved_by: me.id,
      approved_at: new Date().toISOString(),
      rejected_by: null,
      rejected_at: null,
      reject_reason: null,
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');
  if (error) return { error: `承認に失敗しました: ${error.message}` };
  if ((updated ?? []).length === 0) return { error: 'このメールは既に処理されています' };

  if (!isDueNow(item.scheduled_at, new Date())) {
    revalidate(item);
    return { message: '承認しました。指定の日時に送信されます' };
  }

  const cfg = getMailAwsConfig();
  if (!cfg) {
    revalidate(item);
    return { error: '承認しましたが、送信基盤(SES)が未設定のため送信できません' };
  }
  const r = await deliverOutboxItem(admin, cfg, id);
  revalidate(item, r.threadId);
  if (!r.ok) return { error: `承認しましたが送信に失敗しました: ${r.error ?? ''}` };
  return { message: '承認して送信しました', threadId: r.threadId };
}

/** 差し戻し(理由は必須)。作成者が修正して出し直すか、取り消す */
export async function rejectMailOutbox(id: string, reason: string): Promise<OutboxActionResult> {
  const me = await getCurrentUser();
  const item = await loadCore(id);
  if (!item) return { error: '送信待ちのメールが見つかりません' };
  if (!canRejectOutbox(me, item)) return { error: 'このメールは差し戻しできません' };
  const r = (reason ?? '').trim();
  if (!r) return { error: '差し戻しの理由を入力してください' };
  if (r.length > MAX_REJECT_REASON_CHARS) {
    return { error: `理由は ${MAX_REJECT_REASON_CHARS} 文字までです` };
  }

  const admin = createServiceRoleClient();
  const { data: updated, error } = await admin
    .from('mail_outbox')
    .update({
      status: 'rejected',
      rejected_by: me.id,
      rejected_at: new Date().toISOString(),
      reject_reason: r,
      approved_by: null,
      approved_at: null,
    })
    .eq('id', id)
    .in('status', ['pending', 'approved'])
    .select('id');
  if (error) return { error: `差し戻しに失敗しました: ${error.message}` };
  if ((updated ?? []).length === 0) return { error: 'このメールは既に処理されています' };
  revalidate(item);
  return { message: '差し戻しました' };
}

/** 取消(送る前のもの)。物理削除はしない */
export async function cancelMailOutbox(id: string): Promise<OutboxActionResult> {
  const me = await getCurrentUser();
  const item = await loadCore(id);
  if (!item) return { error: '送信待ちのメールが見つかりません' };
  if (!canCancelOutbox(me, item)) return { error: 'このメールは取り消せません' };

  const admin = createServiceRoleClient();
  const { data: updated, error } = await admin
    .from('mail_outbox')
    .update({ status: 'cancelled', cancelled_by: me.id, cancelled_at: new Date().toISOString() })
    .eq('id', id)
    .in('status', ['pending', 'rejected', 'approved', 'failed'])
    .select('id');
  if (error) return { error: `取消に失敗しました: ${error.message}` };
  if ((updated ?? []).length === 0) return { error: 'このメールは既に送信中か処理済みです' };
  revalidate(item);
  return { message: '取り消しました' };
}

/** 修正して出し直す(作成者)。承認済み・差し戻し・送信失敗からでも、もう一度「承認待ち」に戻す */
export async function updateMailOutbox(input: {
  id: string;
  body: string;
  cc?: string;
  /** 新規メールのみ */
  to?: string;
  /** 新規メールのみ */
  subject?: string;
  fromName?: string;
  scheduledAt?: string;
}): Promise<OutboxActionResult> {
  const me = await getCurrentUser();
  const item = await loadCore(input.id);
  if (!item) return { error: '送信待ちのメールが見つかりません' };
  if (!canEditOutbox(me, item))
    return { error: 'このメールは修正できません(作成者本人・送信前のみ)' };

  const body = input.body ?? '';
  if (!body.trim()) return { error: '本文を入力してください' };
  if (body.length > 50_000) return { error: '本文が長すぎます(50,000 文字まで)' };
  const schedule = parseScheduledInput(input.scheduledAt, new Date());
  if (schedule.error) return { error: schedule.error };

  const cc = parseAddressList(input.cc);
  if (cc.error) return { error: cc.error };
  let toAddresses = item.to_addresses;
  const patch: Record<string, unknown> = {};
  if (item.kind === 'new') {
    const to = parseAddressList(input.to);
    if (to.error) return { error: to.error };
    if (to.addresses.length === 0) return { error: '宛先を入力してください' };
    toAddresses = to.addresses;
    const subject = (input.subject ?? '').replace(/\s+/g, ' ').trim();
    if (!subject) return { error: '件名を入力してください' };
    patch.to_addresses = to.addresses;
    patch.subject = subject;
  }
  if (toAddresses.length + cc.addresses.length > MAX_RECIPIENTS) {
    return { error: `宛先が多すぎます(${MAX_RECIPIENTS} 件まで)` };
  }

  const admin = createServiceRoleClient();
  const { data: updated, error } = await admin
    .from('mail_outbox')
    .update({
      ...patch,
      cc_addresses: cc.addresses,
      text_body: `${body.replace(/\s+$/, '')}\n`,
      ...(input.fromName !== undefined ? { from_name: sanitizeDisplayName(input.fromName) } : {}),
      scheduled_at: schedule.at,
      status: 'pending',
      approved_by: null,
      approved_at: null,
      last_error: null,
    })
    .eq('id', input.id)
    .in('status', ['pending', 'rejected', 'approved', 'failed'])
    .select('id');
  if (error) return { error: `保存に失敗しました: ${error.message}` };
  if ((updated ?? []).length === 0) return { error: 'このメールは既に送信中か処理済みです' };
  revalidate(item);
  return { message: '修正して承認依頼を出し直しました' };
}

/** 送信失敗を送り直す(承認者)。承認済みの内容をそのまま送る */
export async function retryMailOutbox(id: string): Promise<OutboxActionResult> {
  const me = await getCurrentUser();
  const item = await loadCore(id);
  if (!item) return { error: '送信待ちのメールが見つかりません' };
  if (!canRetryOutbox(me, item)) return { error: 'このメールは送り直せません' };

  const admin = createServiceRoleClient();
  const { data: updated, error } = await admin
    .from('mail_outbox')
    .update({ status: 'approved', last_error: null })
    .eq('id', id)
    .eq('status', 'failed')
    .select('id');
  if (error) return { error: `送り直しに失敗しました: ${error.message}` };
  if ((updated ?? []).length === 0) return { error: 'このメールは既に処理されています' };

  if (!isDueNow(item.scheduled_at, new Date())) {
    revalidate(item);
    return { message: '予約中に戻しました。指定の日時に送信されます' };
  }
  const cfg = getMailAwsConfig();
  if (!cfg) return { error: '送信基盤(SES)が未設定です' };
  const r = await deliverOutboxItem(admin, cfg, id);
  revalidate(item, r.threadId);
  if (!r.ok) return { error: `送信に失敗しました: ${r.error ?? ''}` };
  return { message: '送信しました', threadId: r.threadId };
}
