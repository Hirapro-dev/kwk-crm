/**
 * 取込候補の未処理メールをまとめて取り込む(過去分の一括実行。CLAUDE.md §5.16 段階③)。
 * 画面の「候補を処理」(1回 300 件)と同じ処理を、上限なしで回す。
 *
 * 使い方:
 *   npx tsx scripts/mail/process_import_candidates.ts            # 全件
 *   npx tsx scripts/mail/process_import_candidates.ts --limit 500
 *
 * 冪等: 処理結果を記録したメール(import_status あり)は対象外。同じメールから
 * 問合せを二重に作らない(source_mail_message_id)。ルールを直した後に再処理したい
 * メールは、mail_messages.import_status を NULL に戻してから実行する。
 */

import { fetchMailImportRules, processCandidateBacklog } from '../../lib/domain/mail_import_exec';
import { parseArgs } from '../migrate/lib/args';
import { createMigrateClient } from '../migrate/lib/db';
import { logger } from '../migrate/lib/logger';

async function main() {
  const args = parseArgs();
  const limit = args.limit ?? Number.MAX_SAFE_INTEGER;
  const supabase = createMigrateClient();
  const rules = await fetchMailImportRules(supabase);
  logger.info(`取込ルール ${rules.length} 件(有効 ${rules.filter((r) => r.is_active).length} 件)`);
  if (rules.length === 0) {
    logger.info('ルールが無いため終了します');
    return;
  }
  let lastLogged = 0;
  const summary = await processCandidateBacklog(supabase, rules, {
    limit,
    onProgress: (s) => {
      if (s.processed - lastLogged >= 500) {
        lastLogged = s.processed;
        logger.info(
          `処理 ${s.processed} 件(作成/紐付け ${s.done} / ルール未一致 ${s.pending} / エラー ${s.error})`,
        );
      }
    },
  });
  logger.info('=== 合計 ===');
  logger.info(
    `処理 ${summary.processed} 件 / 作成・紐付け ${summary.done} / ルール未一致 ${summary.pending} / エラー ${summary.error}${summary.truncated ? '(上限で打ち切り)' : ''}`,
  );
}

main().catch((e) => {
  logger.error('取込に失敗しました', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
