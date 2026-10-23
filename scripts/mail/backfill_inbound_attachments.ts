/**
 * 受信メールで保存されずに消えていた添付を、S3 に残っている元のメールから取り直す(CLAUDE.md §5.15)。
 * 本体は lib/mail/inbound_attachment_backfill.ts(メール設定の「受信添付の取り直し」と同じ処理)。
 *
 * MAIL_AWS_* / MAIL_INBOUND_BUCKET は Vercel で「機密」の環境変数のため手元には取れない。普段は画面
 * (メール設定 → 受信用アドレス →「受信添付の取り直し」)から実行し、このスクリプトは AWS の認証情報を
 * 手元に用意できる場合だけ使う。件数だけを出す(ファイル名・本文は出さない)。
 *
 * 使い方:
 *   npx tsx scripts/mail/backfill_inbound_attachments.ts --days 31 --dry-run
 *   npx tsx scripts/mail/backfill_inbound_attachments.ts --days 31
 */

import { createS3Client, getMailAwsConfig } from '../../lib/mail/aws';
import {
  addBackfillStats,
  backfillInboundAttachmentsBatch,
  emptyBackfillStats,
} from '../../lib/mail/inbound_attachment_backfill';
import { createMigrateClient } from '../migrate/lib/db';

const BATCH = 200;

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const days = Number(argValue('--days') ?? '31');
  if (!Number.isFinite(days) || days <= 0) throw new Error('--days は正の数で指定してください');
  const cfg = getMailAwsConfig();
  if (!cfg) throw new Error('MAIL_AWS_* / MAIL_INBOUND_BUCKET などの環境変数がありません');
  const s3 = createS3Client(cfg);
  const db = createMigrateClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let total = emptyBackfillStats();
  for (let offset = 0; ; offset += BATCH) {
    const r = await backfillInboundAttachmentsBatch({
      db,
      s3,
      bucket: cfg.inboundBucket,
      since,
      offset,
      limit: BATCH,
      dryRun,
    });
    total = addBackfillStats(total, r.stats);
    console.log(`…${total.messages} 通を確認`);
    if (r.done) break;
  }
  console.log(dryRun ? '[dry-run] 書き込みはしていません' : '完了', `(${since} 以降)`);
  console.log(total);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
