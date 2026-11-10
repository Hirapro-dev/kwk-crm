'use server';

/**
 * 送信済みメールの「コピーして編集」(CLAUDE.md §5.15「送信済みメールのコピー」)の Server Action。
 * 送ったメールの中身(送信元・宛先・CC・件名・本文・署名・添付)を、返信フォームに入れる値にして返す。
 * 送ったメール自体は変えない。添付は Storage のファイルを押した人の下書き置き場に複製する
 * (承認依頼のときの検証 isOwnDraftPath を通すため。元のファイルは変えない)。
 * 判断は純粋関数(lib/domain/mail_copy.ts)。
 */

import { getCurrentUser } from '@/lib/domain/auth';
import { listMailSignatures } from '@/lib/domain/mail';
import {
  type CopySourceAttachment,
  planCopyAttachments,
  resolveCopyBoxId,
  sentMailCopyText,
  splitSignature,
} from '@/lib/domain/mail_copy';
import { type MailAttachmentType, draftStoragePath } from '@/lib/domain/mail_outgoing_attachments';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';

export interface SentMailCopy {
  /** 送信元の受信箱(null = 返信フォームの今の送信元のまま) */
  boxId: number | null;
  /** 差出人表示名(送信待ちの記録があるときだけ。null = 送信元の既定) */
  fromName: string | null;
  to: string;
  cc: string;
  subject: string;
  text: string;
  /** 署名マスタの id('' = 署名なし) */
  signatureId: string;
  /** 下書き置き場に複製した添付 */
  attachments: Array<{
    path: string;
    filename: string;
    size: number;
    contentType: MailAttachmentType;
    inline: boolean;
  }>;
  /** 付けられなかった添付などの注意 */
  notes: string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function prepareSentMailCopy(
  messageId: string,
): Promise<{ copy?: SentMailCopy; error?: string }> {
  const me = await getCurrentUser();
  if (me.role === 'viewer') return { error: '閲覧専用ユーザーはコピーできません' };
  if (typeof messageId !== 'string' || !UUID_RE.test(messageId))
    return { error: 'メールの指定が不正です' };

  // 読むのは利用者の権限で(RLS。削除したスレッドのメールは読めない)
  const supabase = await createClient();
  const { data: msg, error: mErr } = await supabase
    .from('mail_messages')
    .select(
      'id, thread_id, direction, from_address, to_addresses, cc_addresses, subject, text_body, html_body',
    )
    .eq('id', messageId)
    .maybeSingle();
  if (mErr) return { error: `メールの読み込みに失敗しました: ${mErr.message}` };
  if (!msg || msg.direction !== 'out') return { error: '送信メールが見つかりません' };
  const { data: thread } = await supabase
    .from('mail_threads')
    .select('id')
    .eq('id', msg.thread_id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!thread) return { error: 'このメールのスレッドは削除されています' };

  // 送信待ちの記録(CRM から承認を通して送ったメール)。あれば本文・送信元・添付はこちらを使う
  const { data: outbox } = await supabase
    .from('mail_outbox')
    .select('id, mail_box_id, from_name, text_body')
    .eq('sent_message_id', msg.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let sources: CopySourceAttachment[] = [];
  if (outbox) {
    const { data } = await supabase
      .from('mail_outbox_attachments')
      .select('filename, content_type, size_bytes, storage_path, content_id')
      .eq('outbox_id', outbox.id)
      .order('sort_order', { ascending: true });
    sources = (data ?? []) as CopySourceAttachment[];
  } else {
    const { data } = await supabase
      .from('mail_attachments')
      .select('filename, content_type, size_bytes, storage_path')
      .eq('message_id', msg.id);
    sources = ((data ?? []) as Omit<CopySourceAttachment, 'content_id'>[]).map((a) => ({
      ...a,
      content_id: null,
    }));
  }

  const signatures = (await listMailSignatures()).filter((s) => s.is_active);
  const split = splitSignature(
    sentMailCopyText({
      outboxText: outbox?.text_body ?? null,
      textBody: msg.text_body,
      htmlBody: msg.html_body,
    }),
    signatures,
  );

  let boxId: number | null = outbox?.mail_box_id ?? null;
  if (boxId == null && msg.from_address) {
    const { data: boxes } = await supabase
      .from('mail_boxes')
      .select('id, address')
      .ilike('address', msg.from_address);
    boxId = resolveCopyBoxId(null, msg.from_address, boxes ?? []);
  }

  // 添付を押した人の下書き置き場に複製する(失敗したものは付けずに知らせる)
  const plan = planCopyAttachments(sources, split.text);
  const notes = [...plan.skipped];
  const bucket = createServiceRoleClient().storage.from('mail-attachments');
  const copied = await Promise.all(
    plan.accepted.map(async (a) => {
      const path = draftStoragePath(me.id, crypto.randomUUID(), a.filename);
      const { error } = await bucket.copy(a.storagePath, path);
      if (error) {
        notes.push(`${a.filename}: 添付ファイルをコピーできませんでした`);
        return null;
      }
      return {
        path,
        filename: a.filename,
        size: a.size,
        contentType: a.contentType,
        inline: a.inline,
      };
    }),
  );

  return {
    copy: {
      boxId,
      fromName: outbox ? (outbox.from_name ?? '') : null,
      to: (msg.to_addresses ?? []).join(', '),
      cc: (msg.cc_addresses ?? []).join(', '),
      subject: msg.subject ?? '',
      text: split.text,
      signatureId: split.signatureId,
      attachments: copied.filter((c) => c !== null),
      notes,
    },
  };
}
