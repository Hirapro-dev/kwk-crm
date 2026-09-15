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
