/**
 * 受信メールで保存されずに消えていた添付を、S3 に残っている元のメールから取り直す(CLAUDE.md §5.15)。
 *
 * 背景(2026-10-23 に判明): 受信 Webhook は添付の Storage のキーに元のファイル名をそのまま使っていたため、
 * 日本語など ASCII 以外の文字を含むファイル名は Storage に "Invalid key" で拒否され、添付だけが消えていた。
 * 受信処理は直したが、それまでの添付は S3 の元のメール(生 MIME。30 日で自動削除)からしか取り直せない。
 *
 * SES で受信したメール(direction=in, source=ses)を古い順に limit 通ずつ見て、まだ保存していない添付を
 * 保存する。判断は純粋関数 pickMissingInboundAttachments。何度実行しても増えない。
 * 呼び出し元: メール設定の「受信添付の取り直し」(Server Action)と scripts/mail/backfill_inbound_attachments.ts。
 * ファイル名・本文は返さない(件数だけ)。
 */

import {
  inboundAttachmentFilename,
  inboundAttachmentStoragePath,
  pickMissingInboundAttachments,
} from '@/lib/domain/mail_inbound';
import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { SupabaseClient } from '@supabase/supabase-js';
import { simpleParser } from 'mailparser';

/** SES 受信ルールが S3 に置くときのキーの接頭辞(scripts/mail/setup_aws.ts の OBJECT_KEY_PREFIX と同じ) */
const OBJECT_KEY_PREFIX = 'inbound/';
/** 同時に読む元のメールの数 */
const CONCURRENCY = 5;

export interface BackfillStats {
  /** 見たメール */
  messages: number;
  /** 元のメールが S3 の保存期間(30 日)を過ぎて無かった */
  expired: number;
  /** 元のメールを読めなかった */
  readErrors: number;
  /** 添付が欠けていたメール */
  withMissing: number;
  /** 取り直した添付(dryRun では取り直せる数) */
  restored: number;
  /** 保存しない添付(実行形式・25MB 超など) */
  skipped: number;
  /** 保存に失敗した添付 */
  saveErrors: number;
}

export function emptyBackfillStats(): BackfillStats {
  return {
    messages: 0,
    expired: 0,
    readErrors: 0,
    withMissing: 0,
    restored: 0,
    skipped: 0,
    saveErrors: 0,
  };
}

export function addBackfillStats(a: BackfillStats, b: BackfillStats): BackfillStats {
  const out = { ...a };
  for (const k of Object.keys(out) as (keyof BackfillStats)[]) out[k] += b[k];
  return out;
}

interface Row {
  id: string;
  thread_id: string;
  provider_message_id: string;
  attachments: { filename: string | null }[];
}

/**
 * since 以降に受信したメールの offset 番目から limit 通を処理する。done = これより後のメールが無い。
 * 並びは created_at の古い順(新しく届いたメールは後ろに足されるので、途中で届いても位置はずれない)。
 */
export async function backfillInboundAttachmentsBatch(args: {
  db: SupabaseClient;
  s3: S3Client;
  bucket: string;
  since: string;
  offset: number;
  limit: number;
  dryRun?: boolean;
}): Promise<{ stats: BackfillStats; done: boolean }> {
  const { db, s3, bucket, since, offset, limit, dryRun } = args;
  const stats = emptyBackfillStats();
  const { data, error } = await db
    .from('mail_messages')
    .select('id, thread_id, provider_message_id, attachments:mail_attachments(filename)')
    .eq('direction', 'in')
    .eq('source', 'ses')
    .gte('created_at', since)
    .not('provider_message_id', 'is', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) throw new Error(`メールの取得に失敗しました: ${error.message}`);
  const rows = (data ?? []) as unknown as Row[];

  const one = async (r: Row) => {
    stats.messages++;
    let parsed: Awaited<ReturnType<typeof simpleParser>>;
    try {
      const obj = await s3.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: `${OBJECT_KEY_PREFIX}${r.provider_message_id}`,
        }),
      );
      const bytes = await obj.Body?.transformToByteArray();
      if (!bytes) throw new Error('empty');
      parsed = await simpleParser(Buffer.from(bytes));
    } catch (e) {
      if ((e as { name?: string }).name === 'NoSuchKey') stats.expired++;
      else stats.readErrors++;
      return;
    }

    const { toSave, skipped } = pickMissingInboundAttachments(
      parsed.attachments ?? [],
      r.attachments.map((a) => a.filename),
    );
    stats.skipped += skipped;
    if (toSave.length === 0) return;
    stats.withMissing++;

    for (const [i, att] of toSave.entries()) {
      if (dryRun) {
        stats.restored++;
        continue;
      }
      const storagePath = inboundAttachmentStoragePath(
        r.thread_id,
        r.id,
        String(att.checksum ?? `r${i}`),
        att.filename,
      );
      const up = await db.storage.from('mail-attachments').upload(storagePath, att.content, {
        contentType: att.contentType || 'application/octet-stream',
        upsert: true,
      });
      if (up.error) {
        stats.saveErrors++;
        continue;
      }
      const ins = await db.from('mail_attachments').insert({
        message_id: r.id,
        filename: inboundAttachmentFilename(att.filename),
        content_type: att.contentType || null,
        size_bytes: att.size ?? att.content.byteLength,
        storage_path: storagePath,
      });
      if (ins.error) stats.saveErrors++;
      else stats.restored++;
    }
  };

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    await Promise.all(rows.slice(i, i + CONCURRENCY).map(one));
  }
  return { stats, done: rows.length < limit };
}
