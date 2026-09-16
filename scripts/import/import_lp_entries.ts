/**
 * LP(lp_entries)の CSV 取込(CLAUDE.md §5.17)。今回限りの一括取込。
 *
 * 元 CSV: Salesforce「問合せ管理」の書き出し(Shift_JIS)。列:
 *   問合せID / 会員ID / 登録月 / フォーム名 / 広告ID / メールアドレス / 氏名 / 氏名かな / 登録日時
 *
 * 使い方:
 *   npx tsx scripts/import/import_lp_entries.ts --file <csv> [--dry-run] [--limit N]
 *   npx tsx scripts/import/import_lp_entries.ts --dir <dir> [--dry-run]
 *
 * - 問合せID(TA-)を主キーに upsert(再実行しても重複しない。冪等)
 * - 会員ID(K-)は members に実在する場合だけ member_id に入れる(無ければ NULL。原文は捨てる)
 * - メールは小文字化。登録日時「2026/09/16 15:07:50」は日本時間として解釈
 * - サービスロールで実行(RLS を迂回)。個人情報はログに出さない
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import iconv from 'iconv-lite';
import { parseArgs } from '../migrate/lib/args';
import { parseCsvString } from '../migrate/lib/csv';
import { createMigrateClient } from '../migrate/lib/db';
import { logger } from '../migrate/lib/logger';

const BATCH = 500;

interface LpRow {
  id: string;
  member_id: string | null;
  registered_month: string | null;
  form_name: string | null;
  ad_id: string | null;
  email: string | null;
  name: string | null;
  name_kana: string | null;
  registered_at: string | null;
}

function nz(v: string | undefined): string | null {
  const s = (v ?? '').trim();
  return s ? s : null;
}

/** 「2026/09/16 15:07:50」(日本時間)→ ISO。形式が違えば null */
export function parseJstDateTime(v: string | null): string | null {
  if (!v) return null;
  const m = v.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = m;
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h) - 9, Number(mi), Number(s));
  const dt = new Date(utc);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

function toRow(r: Record<string, string>): LpRow | null {
  const id = nz(r.問合せID);
  if (!id || !/^TA-\d{7,9}$/.test(id)) return null;
  const member = nz(r.会員ID);
  return {
    id,
    member_id: member && /^K-\d{7,9}$/.test(member) ? member : null,
    registered_month: nz(r.登録月),
    form_name: nz(r.フォーム名),
    ad_id: nz(r.広告ID),
    email: nz(r.メールアドレス)?.toLowerCase() ?? null,
    name: nz(r.氏名),
    name_kana: nz(r.氏名かな),
    registered_at: parseJstDateTime(nz(r.登録日時)),
  };
}

function readRows(file: string): Record<string, string>[] {
  const raw = readFileSync(file);
  // UTF-8 BOM ならそのまま、そうでなければ Shift_JIS(cp932)として読む
  const text =
    raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf
      ? raw.toString('utf8')
      : iconv.decode(raw, 'cp932');
  return parseCsvString(text) as Record<string, string>[];
}

async function main() {
  const args = parseArgs();
  const files: string[] = [];
  if (args.file) files.push(args.file);
  if (args.dir) {
    for (const f of readdirSync(args.dir)
      .filter((f) => f.toLowerCase().endsWith('.csv'))
      .sort()) {
      files.push(join(args.dir, f));
    }
  }
  if (files.length === 0) {
    logger.error('--file または --dir を指定してください');
    process.exit(1);
  }

  const rows: LpRow[] = [];
  let skipped = 0;
  for (const f of files) {
    const raw = readRows(f);
    let ok = 0;
    for (const r of raw) {
      const row = toRow(r);
      if (row) {
        rows.push(row);
        ok++;
      } else skipped++;
    }
    logger.info(`読込 ${f.split('/').pop()}: ${raw.length} 行(有効 ${ok})`);
  }
  const limited = args.limit ? rows.slice(0, args.limit) : rows;
  const memberIds = [...new Set(limited.map((r) => r.member_id).filter((x): x is string => !!x))];
  logger.info(
    `対象 ${limited.length} 行(ID不正でスキップ ${skipped})。会員ID あり ${memberIds.length} 種類`,
  );

  const supabase = createMigrateClient();
  // 会員の実在確認(存在しない会員IDは NULL にする)
  const existing = new Set<string>();
  for (let i = 0; i < memberIds.length; i += BATCH) {
    const { data, error } = await supabase
      .from('members')
      .select('id')
      .in('id', memberIds.slice(i, i + BATCH));
    if (error) throw new Error(`会員の確認に失敗: ${error.message}`);
    for (const m of (data ?? []) as Array<{ id: string }>) existing.add(m.id);
  }
  let unlinked = 0;
  for (const r of limited) {
    if (r.member_id && !existing.has(r.member_id)) {
      r.member_id = null;
      unlinked++;
    }
  }
  logger.info(
    `会員に紐付く行: ${limited.filter((r) => r.member_id).length}(存在しない会員ID ${unlinked} 行は未紐付け)`,
  );

  if (args.dryRun) {
    logger.info('--dry-run のため書き込みません');
    return;
  }
  let done = 0;
  for (let i = 0; i < limited.length; i += BATCH) {
    const batch = limited.slice(i, i + BATCH);
    const { error } = await supabase.from('lp_entries').upsert(batch, { onConflict: 'id' });
    if (error) throw new Error(`upsert に失敗(${i}〜): ${error.message}`);
    done += batch.length;
    if (done % 5000 < BATCH) logger.info(`書込 ${done} / ${limited.length}`);
  }
  logger.info(`完了: ${done} 行を lp_entries に upsert しました`);
}

main().catch((e) => {
  logger.error('取込に失敗しました', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
