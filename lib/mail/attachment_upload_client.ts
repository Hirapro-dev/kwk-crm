/**
 * 送信メールの添付を画面から Storage へ直接アップロードする(CLAUDE.md §5.15「送信メールの添付」)。ブラウザ専用。
 * サーバー(createMailAttachmentUpload)が権限と種類・大きさを確かめて発行したトークンでだけアップロードできる。
 */

import { createMailAttachmentUpload } from '@/lib/domain/mail_attachment_actions';
import { createClient } from '@/lib/supabase/client';

export async function uploadMailAttachment(
  file: File,
  filename: string,
): Promise<{ path?: string; error?: string }> {
  const prep = await createMailAttachmentUpload({
    filename,
    contentType: file.type,
    size: file.size,
  });
  if (!prep.path || !prep.token) return { error: prep.error ?? 'アップロードの準備に失敗しました' };
  const { error } = await createClient()
    .storage.from('mail-attachments')
    .uploadToSignedUrl(prep.path, prep.token, file, {
      contentType: prep.contentType ?? file.type,
    });
  if (error) return { error: `アップロードに失敗しました: ${error.message}` };
  return { path: prep.path };
}
