/**
 * メールディーラーから取り出した添付 PDF を、CRM に取り込み済みのメールに添付として付ける(CLAUDE.md §5.15)。
 * 判断は純粋関数 lib/domain/mail_maildealer_pdf.ts。添付の保存の仕方は受信添付の取り直し
 * (lib/mail/inbound_attachment_backfill.ts)と同じ(バケット mail-attachments + mail_attachments に 1 行)。
 * DB の構造は変えない。何度実行しても増えない(保存先のキーに中身のハッシュを入れて突合する)。
 *
 * 入力(どれも git 管理外。個人情報を含む):
 *   --index <pdf_index.csv>  添付の一覧(mail_id, file, lo, exclude …)
 *   --csv <csv>              メールディーラーの CSV エクスポート(UTF-8。メールID / メールID枝番 / メールヘッダ全体)。複数指定可
 *   --pdf-dir <dir>          取り出した PDF(`MD<メールID>-<枝番>_<添付ID>_…pdf`)。下の階層(年別フォルダ)も探す
 * オプション:
 *   --dry-run                書き込みをせず、件数だけを出す
 *   --limit N                付ける PDF を先頭 N 件までにする(試しの実行用)
 *   --source S               CRM のメールの来源(ses / import_maildealer)がこれのものだけに付ける(試しの実行用)
 *   --concurrency N          同時にアップロードする数(既定 4)
 *   --report <csv>           1 件ごとの結果(ファイル名・メールID・結果)を書く先。個人情報を含むので git 管理外に置く
 *
 * 一覧で除外の印(exclude)がある行は付けない。画面には件数だけを出す(ファイル名・件名は --report にだけ書く)。
 *
 * 使い方(リポジトリ直下で):
 *   npx tsx scripts/mail/attach_maildealer_pdfs.ts --index <…>/pdf_index.csv --csv <…>/normal.csv --csv <…>/archived.csv \
 *     --pdf-dir <…>/maildealer_pdf --report <…>/attach_report.csv --dry-run
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  INBOUND_MAX_ATTACHMENT_BYTES,
  ensureMessageId,
  parseRawHeaders,
} from '../../lib/domain/mail_inbound';
import { maildealerSyntheticMessageId } from '../../lib/domain/mail_maildealer_import';
import {
  decideMaildealerPdf,
  maildealerMailKey,
  maildealerPdfFileKey,
  maildealerPdfIndexKey,
  maildealerPdfStoragePath,
} from '../../lib/domain/mail_maildealer_pdf';
import { storageSafeName } from '../../lib/domain/task_pure';
import { parseCsvString } from '../migrate/lib/csv';
import { createMigrateClient } from '../migrate/lib/db';

const BUCKET = 'mail-attachments';
/** lookup_mail_message_thread_ids は PostgREST の上限で 1 回 1,000 行まで(memory: postgrest-rpc-max-rows-1000) */
const RPC_CHUNK = 1000;
/** .in() は URL に入るので短めに */
const IN_CHUNK = 150;

type Result =
  | 'attached'
  | 'would_attach'
  | 'already_attached'
  | 'same_name_exists'
  | 'duplicate_in_run'
  | 'excluded'
  | 'no_file'
  | 'not_pdf'
  | 'too_large'
  | 'no_csv_row'
  | 'not_in_crm'
  | 'other_source'
  | 'upload_error'
  | 'insert_error';

function argValues(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((a, i) => {
    if (a === name && process.argv[i + 1]) out.push(process.argv[i + 1] as string);
  });
  return out;
}
function argValue(name: string): string | undefined {
  return argValues(name)[0];
}

function readCsv(path: string): Array<Record<string, string>> {
  return parseCsvString(readFileSync(path, 'utf8').replace(/^﻿/, '')) as Array<
    Record<string, string>
  >;
}

/** dir 以下の MD…pdf を探し、突合キー → パス にする(_incoming でも年別フォルダでも同じに動く) */
function scanPdfFiles(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (name.startsWith('._')) continue; // macOS の付属ファイル
      const p = join(d, name);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      const key = maildealerPdfFileKey(name);
      if (key && !out.has(key)) out.set(key, p);
    }
  };
  walk(dir);
  return out;
}

async function mapLimit<T>(items: T[], limit: number, fn: (t: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i] as T);
      }
    }),
  );
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const indexPath = argValue('--index');
  const csvPaths = argValues('--csv');
  const pdfDir = argValue('--pdf-dir');
  const reportPath = argValue('--report');
  const limit = Number(argValue('--limit') ?? '0') || Number.POSITIVE_INFINITY;
  const concurrency = Number(argValue('--concurrency') ?? '4') || 4;
  const onlySource = argValue('--source');
  if (!indexPath || csvPaths.length === 0 || !pdfDir) {
    throw new Error('--index と --csv(1 つ以上)と --pdf-dir を指定してください');
  }

  // 1) メールディーラーのメール(<メールID>-<枝番>)→ CRM の message_id(取込と同じ決め方)
  const mailToMessageId = new Map<string, string>();
  for (const p of csvPaths) {
    for (const row of readCsv(p)) {
      const key = maildealerMailKey(row.メールID ?? '', row.メールID枝番 ?? '');
      const h = (parseRawHeaders(row.メールヘッダ全体 ?? '')['message-id'] ?? '').trim();
      const id = h
        ? ensureMessageId(h)
        : maildealerSyntheticMessageId(row.メールID, row.メールID枝番);
      if (id) mailToMessageId.set(key, id);
    }
  }
  console.log(`CSV: ${mailToMessageId.size} 通`);

  // 2) 添付の一覧と手元のファイル
  const index = readCsv(indexPath);
  const files = scanPdfFiles(pdfDir);
  console.log(`一覧: ${index.length} 件 / 手元の PDF: ${files.size} 件`);

  // 3) CRM のメール(message_id → 行 id・スレッド)と既存の添付
  const db = createMigrateClient();
  const wanted = [...new Set([...mailToMessageId.values()])];
  const msgToThread = new Map<string, string>();
  for (let i = 0; i < wanted.length; i += RPC_CHUNK) {
    const { data, error } = await db.rpc('lookup_mail_message_thread_ids', {
      p_message_ids: wanted.slice(i, i + RPC_CHUNK),
    });
    if (error) throw new Error(`lookup_mail_message_thread_ids: ${error.message}`);
    for (const r of (data ?? []) as Array<{ message_id: string; thread_id: string }>) {
      msgToThread.set(r.message_id, r.thread_id);
    }
  }
  const neededMessageIds = new Set<string>();
  for (const r of index) {
    const mid = mailToMessageId.get((r.mail_id ?? '').trim());
    if (mid && msgToThread.has(mid)) neededMessageIds.add(mid);
  }
  const msgRow = new Map<string, { id: string; thread_id: string; source: string }>();
  const existing = new Map<string, { filename: string | null; storage_path: string }[]>();
  const needList = [...neededMessageIds];
  for (let i = 0; i < needList.length; i += IN_CHUNK) {
    const { data, error } = await db
      .from('mail_messages')
      .select('id, thread_id, message_id, source, mail_attachments(filename, storage_path)')
      .in('message_id', needList.slice(i, i + IN_CHUNK));
    if (error) throw new Error(`mail_messages: ${error.message}`);
    for (const r of (data ?? []) as Array<{
      id: string;
      thread_id: string;
      message_id: string;
      source: string;
      mail_attachments: { filename: string | null; storage_path: string }[];
    }>) {
      msgRow.set(r.message_id, { id: r.id, thread_id: r.thread_id, source: r.source });
      existing.set(r.id, r.mail_attachments ?? []);
    }
  }
  console.log(`CRM にあるメール: ${msgRow.size} 通`);

  // 4) 1 件ずつ判断(読み込み・ハッシュ)してから、付けるものをアップロード
  const counts: Partial<Record<Result, number>> = {};
  let attachedBytes = 0;
  const report: string[] = ['mail_id,lo,file,result'];
  const note = (r: Record<string, string>, res: Result) => {
    counts[res] = (counts[res] ?? 0) + 1;
    const q = (s: string) => `"${(s ?? '').replace(/"/g, '""')}"`;
    report.push([q(r.mail_id ?? ''), q(r.lo ?? ''), q(r.file ?? ''), res].join(','));
  };
  const planned = new Set<string>();
  const jobs: Array<{
    row: Record<string, string>;
    path: string;
    messageRowId: string;
    storagePath: string;
    filename: string;
    size: number;
  }> = [];

  for (const r of index) {
    if (jobs.length >= limit) break;
    if ((r.exclude ?? '').trim()) {
      note(r, 'excluded');
      continue;
    }
    const filePath = files.get(maildealerPdfIndexKey(r.mail_id ?? '', r.lo ?? ''));
    if (!filePath) {
      note(r, 'no_file');
      continue;
    }
    const mid = mailToMessageId.get((r.mail_id ?? '').trim());
    if (!mid) {
      note(r, 'no_csv_row');
      continue;
    }
    const m = msgRow.get(mid);
    if (!m) {
      note(r, 'not_in_crm');
      continue;
    }
    if (onlySource && m.source !== onlySource) {
      note(r, 'other_source');
      continue;
    }
    const buf = readFileSync(filePath);
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      note(r, 'not_pdf');
      continue;
    }
    if (buf.byteLength > INBOUND_MAX_ATTACHMENT_BYTES) {
      note(r, 'too_large');
      continue;
    }
    // ファイル名は一覧の元の名前(手元のファイル名は記号を置き換えてある)
    const filename = (r.file ?? '').trim() || basename(filePath).replace(/^MD\d+-\d+_\d+_/, '');
    const sha = createHash('sha256').update(buf).digest('hex');
    const storagePath = maildealerPdfStoragePath(m.thread_id, m.id, sha, storageSafeName(filename));
    const d = decideMaildealerPdf({
      storagePath,
      filename,
      existing: existing.get(m.id) ?? [],
      plannedPaths: planned,
    });
    if (d.action === 'skip') {
      note(r, d.reason);
      continue;
    }
    planned.add(storagePath);
    jobs.push({
      row: r,
      path: filePath,
      messageRowId: m.id,
      storagePath,
      filename,
      size: buf.byteLength,
    });
  }

  if (dryRun) {
    for (const j of jobs) {
      note(j.row, 'would_attach');
      attachedBytes += j.size;
    }
  } else {
    let done = 0;
    await mapLimit(jobs, concurrency, async (j) => {
      const buf = readFileSync(j.path);
      const up = await db.storage
        .from(BUCKET)
        .upload(j.storagePath, buf, { contentType: 'application/pdf', upsert: true });
      if (up.error) {
        note(j.row, 'upload_error');
        console.error(`アップロード失敗(${j.row.mail_id}): ${up.error.message}`);
        return;
      }
      const ins = await db.from('mail_attachments').insert({
        message_id: j.messageRowId,
        filename: j.filename,
        content_type: 'application/pdf',
        size_bytes: j.size,
        storage_path: j.storagePath,
      });
      if (ins.error) {
        note(j.row, 'insert_error');
        console.error(`登録失敗(${j.row.mail_id}): ${ins.error.message}`);
        return;
      }
      note(j.row, 'attached');
      attachedBytes += j.size;
      done++;
      if (done % 200 === 0) console.log(`…${done} / ${jobs.length} 件を付けました`);
    });
  }

  if (reportPath) writeFileSync(reportPath, `﻿${report.join('\r\n')}\r\n`);
  console.log(dryRun ? '[dry-run] 書き込みはしていません' : '完了');
  console.log(counts);
  console.log(
    `${dryRun ? '付ける予定' : '付けた'}容量: ${(attachedBytes / 1024 / 1024 / 1024).toFixed(2)} GB`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
