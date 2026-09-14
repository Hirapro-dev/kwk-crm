/**
 * 過去データ取込(import_maildealer.ts)で落ちていた宛先(To)を補正する(CLAUDE.md §5.15)。
 *
 * 背景(2026-09-14 に判明):
 *   取込スクリプトは宛先を CSV の「Toアドレス」列(受信箱のアドレス1つ)から取り、ヘッダーの
 *   To 行(複数宛先)を見ていなかった。そのため、フォーム通知に同送されていた旧「メール to リード」
 *   用アドレスが落ち、過去分が「取込候補」にならなかった。CSV のヘッダー To 行には残っている。
 *
 * やること:
 *   CSV を読み直し、ヘッダーの To 行 + Toアドレス列から全宛先を組み立て、message_id で突合して
 *   mail_messages.to_addresses を置き換える(migration 85 の RPC)。あわせて、宛先に取込候補の
 *   判定アドレスを含むスレッドに is_import_candidate を立てる。本文など他の列は触らない。
 *   Message-ID の無い行(取込時にランダムな ID を付けたもの)は突合できないため対象外。
 *   何度実行しても同じ結果(冪等)。
 *
 * 使い方:
 *   npx tsx scripts/mail/repair_maildealer_recipients.ts --dir <CSVが並ぶディレクトリ> --dry-run
 *   npx tsx scripts/mail/repair_maildealer_recipients.ts --dir <CSVが並ぶディレクトリ>
 */

import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { ensureMessageId, parseAddressList, parseRawHeaders } from '../../lib/domain/mail_inbound';
import { MAIL_IMPORT_CANDIDATE_ADDRESSES } from '../../lib/domain/mail_types';
import { parseArgs } from '../migrate/lib/args';
import { parseCsvString } from '../migrate/lib/csv';
import { createMigrateClient } from '../migrate/lib/db';
import { logger } from '../migrate/lib/logger';

const CHUNK_SIZE = 500;

interface RepairRow {
  message_id: string;
  to_addresses: string[];
}

interface FileStats {
  rows: number;
  inbound: number;
  noMessageId: number;
  /** ヘッダーの To 行に「Toアドレス」列以外の宛先があった行 */
  withExtraRecipients: number;
  /** 宛先に取込候補の判定アドレスを含む行 */
  withCandidateAddress: number;
  updatedMessages: number;
  flaggedThreads: number;
}

function emptyStats(): FileStats {
  return {
    rows: 0,
    inbound: 0,
    noMessageId: 0,
    withExtraRecipients: 0,
    withCandidateAddress: 0,
    updatedMessages: 0,
    flaggedThreads: 0,
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** 補正対象行の組み立て(純粋。CSV の1行 → 置き換える宛先) */
export function buildRepairRow(row: Record<string, string>): {
  row: RepairRow | null;
  reason?: 'outbound' | 'no_message_id' | 'no_extra';
} {
  if ((row.メール種別 ?? '') === '送信メール') return { row: null, reason: 'outbound' };
  const headers = parseRawHeaders(row.メールヘッダ全体 ?? '');
  const rawId = headers['message-id'];
  if (!rawId) return { row: null, reason: 'no_message_id' };
  const toColumn = (row.Toアドレス ?? '').trim().toLowerCase();
  const merged = [...new Set([...parseAddressList(headers.to), ...(toColumn ? [toColumn] : [])])];
  const onlyColumn = toColumn ? [toColumn] : [];
  const same = merged.length === onlyColumn.length && merged.every((a, i) => a === onlyColumn[i]);
  if (same) return { row: null, reason: 'no_extra' };
  return { row: { message_id: ensureMessageId(rawId), to_addresses: merged } };
}

function resolveFiles(dir: string): string[] {
  const abs = resolve(dir);
  return readdirSync(abs)
    .filter((f) => extname(f).toLowerCase() === '.csv')
    .sort()
    .map((f) => join(abs, f));
}

async function processFile(
  filepath: string,
  dryRun: boolean,
  supabase: ReturnType<typeof createMigrateClient>,
): Promise<FileStats> {
  const stats = emptyStats();
  const text = new TextDecoder('shift-jis').decode(readFileSync(filepath));
  const rawRows = parseCsvString(text) as Array<Record<string, string>>;
  stats.rows = rawRows.length;

  const candidates = new Set(MAIL_IMPORT_CANDIDATE_ADDRESSES.map((a) => a.toLowerCase()));
  const repairs: RepairRow[] = [];
  for (const row of rawRows) {
    const r = buildRepairRow(row);
    if (r.reason !== 'outbound') stats.inbound++;
    if (r.reason === 'no_message_id') stats.noMessageId++;
    if (!r.row) continue;
    stats.withExtraRecipients++;
    if (r.row.to_addresses.some((a) => candidates.has(a))) stats.withCandidateAddress++;
    repairs.push(r.row);
  }

  logger.info(
    `${filepath}: 行 ${stats.rows} / 受信 ${stats.inbound} / Message-ID 無し ${stats.noMessageId} / ` +
      `宛先に追加あり ${stats.withExtraRecipients}(うち判定アドレス含む ${stats.withCandidateAddress})`,
  );
  if (dryRun || repairs.length === 0) return stats;

  for (const c of chunk(repairs, CHUNK_SIZE)) {
    const { data, error } = await supabase.rpc('repair_mail_message_recipients', {
      p_rows: c,
      p_candidate_addresses: [...candidates],
    });
    if (error) throw new Error(`宛先の補正に失敗: ${error.message}`);
    const r = (Array.isArray(data) ? data[0] : data) as
      | { updated_messages: number; flagged_threads: number }
      | undefined;
    stats.updatedMessages += Number(r?.updated_messages ?? 0);
    stats.flaggedThreads += Number(r?.flagged_threads ?? 0);
  }
  logger.info(
    `${filepath}: 宛先を更新 ${stats.updatedMessages} 件 / 取込候補にしたスレッド ${stats.flaggedThreads} 件`,
  );
  return stats;
}

async function main() {
  const args = parseArgs();
  if (!args.dir) throw new Error('--dir <CSVが並ぶディレクトリ> を指定してください');
  const files = resolveFiles(args.dir);
  logger.info(`対象ファイル: ${files.length} 件${args.dryRun ? '(dry-run: 書込みなし)' : ''}`);
  const supabase = createMigrateClient();

  const total = emptyStats();
  for (const f of files) {
    const s = await processFile(f, args.dryRun, supabase);
    for (const k of Object.keys(total) as Array<keyof FileStats>) total[k] += s[k];
  }
  logger.info('=== 合計 ===');
  logger.info(
    `行 ${total.rows} / 受信 ${total.inbound} / Message-ID 無し ${total.noMessageId} / ` +
      `宛先に追加あり ${total.withExtraRecipients}(うち判定アドレス含む ${total.withCandidateAddress})`,
  );
  if (!args.dryRun) {
    logger.info(
      `宛先を更新 ${total.updatedMessages} 件 / 取込候補にしたスレッド ${total.flaggedThreads} 件`,
    );
  }
}

main().catch((e) => {
  logger.error('補正に失敗しました', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
