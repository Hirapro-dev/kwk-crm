/**
 * 送信待ちメールへの添付の登録(CLAUDE.md §5.15「送信メールの添付」/ migration 128)。サーバー専用。
 * 承認依頼の Server Action(mail_send_actions.ts)から使う。
 * 画面から来た一覧を、Storage に実際に置かれたファイルの大きさ・種類で確かめる(判断は純粋関数 planOutboxAttachments)。
 */

import {
  type OutboxAttachmentRow,
  type SubmittedAttachment,
  planOutboxAttachments,
} from '@/lib/domain/mail_outgoing_attachments';
import type { createServiceRoleClient } from '@/lib/supabase/server';

type AdminClient = ReturnType<typeof createServiceRoleClient>;

/** 添付を確かめて、登録する行を返す(まだ書き込まない) */
export async function prepareOutboxAttachments(
  admin: AdminClient,
  userId: string,
  items: readonly SubmittedAttachment[] | undefined,
): Promise<{ rows?: OutboxAttachmentRow[]; error?: string }> {
  if (!items || items.length === 0) return { rows: [] };
  const bucket = admin.storage.from('mail-attachments');
  const meta = new Map<string, { size: number; contentType: string | null } | undefined>();
  await Promise.all(
    items.slice(0, 20).map(async (it) => {
      if (typeof it?.path !== 'string') return;
      const { data } = await bucket.info(it.path);
      meta.set(
        it.path,
        data && typeof data.size === 'number'
          ? { size: data.size, contentType: data.contentType ?? null }
          : undefined,
      );
    }),
  );
  return planOutboxAttachments(
    items,
    meta,
    userId,
    (i) => `img${i}.${crypto.randomUUID()}@crm.local`,
  );
}

/** 確かめた添付を送信待ちメールに登録する */
export async function insertOutboxAttachments(
  admin: AdminClient,
  outboxId: string,
  userId: string,
  rows: readonly OutboxAttachmentRow[],
): Promise<string | null> {
  if (rows.length === 0) return null;
  const { error } = await admin
    .from('mail_outbox_attachments')
    .insert(rows.map((r) => ({ ...r, outbox_id: outboxId, created_by: userId })));
  return error ? error.message : null;
}
