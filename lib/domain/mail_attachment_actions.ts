'use server';

/**
 * メーラーの送信メールの添付(CLAUDE.md §5.15「送信メールの添付」/ migration 128)のアップロード用 Server Action。
 *
 * ファイルはサーバーを通さず、画面から Storage(非公開バケット mail-attachments)へ直接アップロードする
 * (Vercel の 1 リクエスト約 4.5MB の上限を避けるため)。ここでは権限と種類・大きさを確かめてから、
 * 本人の下書き置き場(outbox-draft/<利用者ID>/…)への一時的なアップロード URL(トークン)だけを発行する。
 * 承認依頼のときに、実際に置かれたファイルの大きさ・種類をもう一度確かめて登録する(mail_send_actions.ts)。
 */

import { getCurrentUser } from '@/lib/domain/auth';
import { checkNewAttachments, draftStoragePath } from '@/lib/domain/mail_outgoing_attachments';
import { createServiceRoleClient } from '@/lib/supabase/server';

export async function createMailAttachmentUpload(input: {
  filename: string;
  contentType: string;
  size: number;
}): Promise<{ path?: string; token?: string; contentType?: string; error?: string }> {
  const me = await getCurrentUser();
  if (me.role === 'viewer') return { error: '閲覧専用ユーザーは添付できません' };
  const filename = String(input.filename ?? '');
  const check = checkNewAttachments(
    [],
    [{ name: filename, size: Number(input.size) || 0, type: String(input.contentType ?? '') }],
  );
  const ok = check.accepted[0];
  if (!ok) return { error: check.errors[0] ?? '添付できないファイルです' };

  const path = draftStoragePath(me.id, crypto.randomUUID(), filename);
  const { data, error } = await createServiceRoleClient()
    .storage.from('mail-attachments')
    .createSignedUploadUrl(path);
  if (error || !data) return { error: `アップロードの準備に失敗しました: ${error?.message ?? ''}` };
  return { path, token: data.token, contentType: ok.contentType };
}
