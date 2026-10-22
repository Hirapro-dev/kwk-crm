/**
 * スレッドの状態を送信待ちメールに合わせる(migration 129「承認待ち」。CLAUDE.md §5.15)。サーバー専用。
 * 返信が承認待ちの間は「承認待ち」、承認待ちが無くなったら「対応中」に戻す。判断は純粋関数 threadStatusAfterOutboxChange。
 * 送信待ちの作成・修正・承認・差し戻し・取消・送信のたびに呼ぶ。失敗しても本体の処理は止めない(状態の表示がずれるだけ)。
 */

import { threadStatusAfterOutboxChange } from '@/lib/domain/mail_outbox';
import type { MailStatus } from '@/lib/domain/mail_types';
import type { createServiceRoleClient } from '@/lib/supabase/server';

type AdminClient = ReturnType<typeof createServiceRoleClient>;

export async function syncThreadStatusWithOutbox(
  admin: AdminClient,
  threadId: string | null | undefined,
): Promise<void> {
  if (!threadId) return;
  try {
    const [{ count, error: cErr }, { data: thread, error: tErr }] = await Promise.all([
      admin
        .from('mail_outbox')
        .select('id', { count: 'exact', head: true })
        .eq('thread_id', threadId)
        .eq('status', 'pending'),
      admin.from('mail_threads').select('status').eq('id', threadId).maybeSingle(),
    ]);
    if (cErr || tErr || !thread) return;
    const next = threadStatusAfterOutboxChange(
      (thread as { status: MailStatus }).status,
      (count ?? 0) > 0,
    );
    if (next) await admin.from('mail_threads').update({ status: next }).eq('id', threadId);
  } catch {
    // 表示用の状態合わせのため、失敗しても呼び出し元の処理は続ける
  }
}
