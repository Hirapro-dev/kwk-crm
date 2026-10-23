'use server';

/**
 * 受信添付の取り直し(CLAUDE.md §5.15。メール設定の「受信添付の取り直し」)。admin のみ。
 * 日本語名の添付が保存されずに消えていた不具合(2026-10-23 修正)の分を、S3 の元のメールから取り直す。
 * AWS の認証情報はサーバーにしか無いため、画面から offset をずらしながら繰り返し呼ぶ(1 回 limit 通)。
 * 本体は lib/mail/inbound_attachment_backfill.ts。書込みはサービスロール。
 */

import { getCurrentUser } from '@/lib/domain/auth';
import { createS3Client, getMailAwsConfig } from '@/lib/mail/aws';
import {
  type BackfillStats,
  backfillInboundAttachmentsBatch,
} from '@/lib/mail/inbound_attachment_backfill';
import { createServiceRoleClient } from '@/lib/supabase/server';

/** 1 回に見るメールの数(Vercel の関数の実行時間に収まるように) */
const BATCH = 100;
/** S3 の元のメールの保存期間(30 日)より少し長く見る */
const DAYS = 31;

export async function backfillInboundAttachments(input: {
  /** 1 回目の呼び出しで決めた対象期間の始まり(以後の呼び出しでも同じ値を渡す) */
  since?: string;
  offset: number;
}): Promise<{ error?: string; since?: string; stats?: BackfillStats; done?: boolean }> {
  const me = await getCurrentUser();
  if (me.role !== 'admin') return { error: '管理者のみ実行できます' };
  const offset = Number(input.offset);
  if (!Number.isInteger(offset) || offset < 0) return { error: '位置の指定が不正です' };
  const since = input.since ?? new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString();
  if (Number.isNaN(Date.parse(since))) return { error: '期間の指定が不正です' };
  const cfg = getMailAwsConfig();
  if (!cfg) return { error: 'AWS の設定がありません' };

  try {
    const r = await backfillInboundAttachmentsBatch({
      db: createServiceRoleClient(),
      s3: createS3Client(cfg),
      bucket: cfg.inboundBucket,
      since,
      offset,
      limit: BATCH,
    });
    return { since, stats: r.stats, done: r.done };
  } catch (e) {
    return { error: e instanceof Error ? e.message : '取り直しに失敗しました' };
  }
}
