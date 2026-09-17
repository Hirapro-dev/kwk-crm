'use server';

/**
 * メール取込の実行(段階③)の Server Actions。CLAUDE.md §5.16。admin のみ。
 * - processMailMessageImport: メール詳細の「このメールを処理」(1通)
 * - processImportCandidates: /mail/settings の「候補を処理」(未処理分をまとめて。上限つき)
 * 書込みは CSV 取込(import_inquiries.ts)と同じくサービスロールで行う
 * (forms の追加・inquiries の作成・mail_messages の更新を1つの権限でまとめるため)。
 */

import { getCurrentUser } from '@/lib/domain/auth';
import {
  type BacklogSummary,
  type ImportOutcome,
  fetchMailImportRules,
  importMailMessage,
  processCandidateBacklog,
} from '@/lib/domain/mail_import_exec';
import { ruleMismatchReasons } from '@/lib/domain/mail_import_rules';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

async function requireAdmin(): Promise<string | null> {
  const me = await getCurrentUser();
  return me.role === 'admin' ? null : '管理者のみ実行できます';
}

function revalidate() {
  revalidatePath('/mail', 'layout');
  revalidatePath('/inquiries');
}

export async function processMailMessageImport(
  messageRowId: string,
): Promise<{ error?: string; outcome?: ImportOutcome }> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('mail_messages')
    .select(
      'id, message_id, thread_id, from_address, subject, text_body, html_body, sent_at, direction',
    )
    .eq('id', messageRowId)
    .maybeSingle();
  if (error || !data) return { error: 'メールが見つかりません' };
  const row = data as {
    id: string;
    message_id: string;
    thread_id: string;
    from_address: string;
    subject: string | null;
    text_body: string | null;
    html_body: string | null;
    sent_at: string | null;
    direction: 'in' | 'out';
  };
  if (row.direction !== 'in') return { error: '送信メールは取込の対象外です' };
  const { data: thread } = await supabase
    .from('mail_threads')
    .select('mail_box_id')
    .eq('id', row.thread_id)
    .maybeSingle();
  try {
    const rules = await fetchMailImportRules(supabase);
    const outcome = await importMailMessage(
      supabase,
      { ...row, mail_box_id: (thread as { mail_box_id: number } | null)?.mail_box_id ?? null },
      rules,
    );
    revalidate();
    return { outcome };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

const BACKLOG_LIMIT = 300;
const APPLY_MAX = 500;

/** スレッドの最新の受信メッセージ(取込の対象)を受信箱つきで取る */
async function latestInboundOfThreads(
  supabase: ReturnType<typeof createServiceRoleClient>,
  threadIds: string[],
): Promise<
  Array<{
    id: string;
    message_id: string;
    thread_id: string;
    mail_box_id: number | null;
    from_address: string;
    subject: string | null;
    text_body: string | null;
    html_body: string | null;
    sent_at: string | null;
  }>
> {
  const { data: msgs, error } = await supabase
    .from('mail_messages')
    .select('id, message_id, thread_id, from_address, subject, text_body, html_body, sent_at')
    .in('thread_id', threadIds)
    .eq('direction', 'in')
    .order('sent_at', { ascending: false });
  if (error) throw new Error(`メールの取得に失敗: ${error.message}`);
  const { data: threads } = await supabase
    .from('mail_threads')
    .select('id, mail_box_id')
    .in('id', threadIds);
  const boxByThread = new Map(
    ((threads ?? []) as Array<{ id: string; mail_box_id: number }>).map((t) => [
      t.id,
      t.mail_box_id,
    ]),
  );
  const seen = new Set<string>();
  const out: Awaited<ReturnType<typeof latestInboundOfThreads>> = [];
  for (const m of (msgs ?? []) as Array<Omit<(typeof out)[number], 'mail_box_id'>>) {
    if (seen.has(m.thread_id)) continue;
    seen.add(m.thread_id);
    out.push({ ...m, mail_box_id: boxByThread.get(m.thread_id) ?? null });
  }
  return out;
}

/**
 * 既存ルールをこのメールに当てはめたとき、一致しなかった理由(注釈)を返す(書込みなし。2026-09-17)。
 * 取込候補の一覧で「ルールを当てはめる」を選んだときに出す。
 */
export async function previewImportRuleMismatch(
  threadId: string,
  ruleId: number,
): Promise<{ error?: string; reasons?: string[]; ruleName?: string }> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };
  const supabase = createServiceRoleClient();
  try {
    const rules = await fetchMailImportRules(supabase);
    const rule = rules.find((r) => r.id === ruleId);
    if (!rule) return { error: 'ルールが見つかりません' };
    const [msg] = await latestInboundOfThreads(supabase, [threadId]);
    if (!msg) return { error: '受信メールが見つかりません' };
    return {
      ruleName: rule.name,
      reasons: ruleMismatchReasons(rule, {
        mailBoxId: msg.mail_box_id,
        fromAddress: msg.from_address,
        subject: msg.subject,
        textBody: msg.text_body,
        htmlBody: msg.html_body,
      }),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 既存ルールを選んだスレッド(最新の受信メール)に手で当てはめて取り込む(条件に一致しなくても適用。2026-09-17)。
 * 一致しなかった理由は処理結果の注釈に残る。1 回 500 件まで。admin のみ。
 */
export async function applyImportRuleToThreads(input: {
  threadIds: string[];
  ruleId: number;
}): Promise<{ error?: string; summary?: BacklogSummary; notes?: string[] }> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };
  const ids = [...new Set((input.threadIds ?? []).filter((id) => typeof id === 'string' && id))];
  if (ids.length === 0) return { error: 'メールが選択されていません' };
  if (ids.length > APPLY_MAX) return { error: `一度に処理できるのは ${APPLY_MAX} 件までです` };
  const supabase = createServiceRoleClient();
  try {
    const rules = await fetchMailImportRules(supabase);
    const rule = rules.find((r) => r.id === input.ruleId);
    if (!rule) return { error: 'ルールが見つかりません' };
    const msgs = await latestInboundOfThreads(supabase, ids);
    const summary: BacklogSummary = {
      processed: 0,
      done: 0,
      pending: 0,
      error: 0,
      truncated: false,
    };
    const notes: string[] = [];
    for (const m of msgs) {
      const outcome = await importMailMessage(supabase, m, rules, { forceRule: rule });
      summary.processed++;
      summary[outcome.status]++;
      notes.push(outcome.note);
    }
    revalidate();
    return { summary, notes };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function processImportCandidates(): Promise<{
  error?: string;
  summary?: BacklogSummary;
}> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };
  const supabase = createServiceRoleClient();
  try {
    const rules = await fetchMailImportRules(supabase);
    const summary = await processCandidateBacklog(supabase, rules, { limit: BACKLOG_LIMIT });
    revalidate();
    return { summary };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
