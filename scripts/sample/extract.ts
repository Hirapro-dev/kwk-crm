/**
 * CSV サンプル抽出 + サニタイズスクリプト
 * 仕様書 §15-6 厳守。csv/ → サニタイズ → csv/_dummy/
 *
 * 使い方:
 *   npm run sample:csv
 *   npm run sample:csv -- --members=300 --activities=3000
 *
 * v3: 「担当顧客」「働くDBユーザ」「営業担当候補」「申込獲得者対象」等の
 *     非標準的な氏名列にもパターンを拡張。
 */

import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';

import {
  sanitizeAddress,
  sanitizeBirthdate,
  sanitizeEmail,
  sanitizeFreeText,
  sanitizeName,
  sanitizePhone,
  sanitizePostalCode,
} from './lib/sanitize';

interface SampleConfig {
  users: number;
  forms: number;
  projects: number;
  members: number;
  inquiries: number;
  applications: number;
  activities: number;
}

const DEFAULT_CONFIG: SampleConfig = {
  users: 200,
  forms: 200,
  projects: 200,
  members: 300,
  inquiries: 200,
  applications: 200,
  activities: 3000,
};

const STREAM_THRESHOLD_BYTES = 50 * 1024 * 1024;

function parseArgs(): Partial<SampleConfig> {
  const out: Partial<SampleConfig> = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--(\w+)=(\d+)$/);
    if (m) {
      const k = m[1] as keyof SampleConfig;
      out[k] = Number.parseInt(m[2]!, 10);
    }
  }
  return out;
}

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0]!.map((h) => h.trim());
  const result: Record<string, string>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r]!;
    if (cells.length === 1 && cells[0] === '') continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c] ?? `_col${c}`] = cells[c] ?? '';
    }
    result.push(obj);
  }
  return { headers, rows: result };
}

async function streamHeadCsv(
  filepath: string,
  maxDataRows: number,
): Promise<{ headers: string[]; rows: Record<string, string>[]; totalRowsInFile: number | null }> {
  const stream = createReadStream(filepath, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });

  let headers: string[] | null = null;
  let buffer = '';
  let inOpenQuote = false;
  const dataRows: Record<string, string>[] = [];
  let firstLine = true;
  let totalCount = 0;

  for await (const rawLine of rl) {
    let line = rawLine;
    if (firstLine) {
      if (line.charCodeAt(0) === 0xfeff) line = line.slice(1);
      firstLine = false;
    }
    const combined = inOpenQuote ? `${buffer}\n${line}` : line;
    let qCount = 0;
    let j = 0;
    while (j < combined.length) {
      if (combined[j] === '"') {
        if (combined[j + 1] === '"') {
          j += 2;
          continue;
        }
        qCount++;
      }
      j++;
    }
    if (qCount % 2 !== 0) {
      buffer = combined;
      inOpenQuote = true;
      continue;
    }
    buffer = '';
    inOpenQuote = false;
    const cells = parseSingleCsvLine(combined);
    if (!headers) {
      headers = cells.map((h) => h.trim());
      continue;
    }
    if (cells.length === 1 && cells[0] === '') continue;
    totalCount++;
    if (dataRows.length < maxDataRows) {
      const obj: Record<string, string> = {};
      for (let c = 0; c < headers.length; c++) {
        obj[headers[c] ?? `_col${c}`] = cells[c] ?? '';
      }
      dataRows.push(obj);
    }
    if (totalCount > maxDataRows * 2) {
      rl.close();
      stream.destroy();
      return { headers: headers ?? [], rows: dataRows, totalRowsInFile: null };
    }
  }

  return { headers: headers ?? [], rows: dataRows, totalRowsInFile: totalCount };
}

function parseSingleCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      out.push(field);
      field = '';
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  out.push(field);
  return out;
}

function escapeCsvValue(v: string): string {
  if (v.includes(',') || v.includes('"') || v.includes('\n') || v.includes('\r')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function writeCsv(filepath: string, headers: string[], rows: Record<string, string>[]): void {
  const lines: string[] = [];
  lines.push(headers.map(escapeCsvValue).join(','));
  for (const r of rows) {
    lines.push(headers.map((h) => escapeCsvValue(r[h] ?? '')).join(','));
  }
  writeFileSync(filepath, `\uFEFF${lines.join('\n')}\n`, 'utf-8');
}

// ============================================================================
// サニタイズ対象列(v3: 範囲拡大)
// ============================================================================
const SANITIZE_PATTERNS: Array<{
  match: RegExp;
  sanitizer: (val: string, seq: number) => string;
}> = [
  // 氏名カナ系
  { match: /氏名カナ|カナ氏名|フリガナ|ふりがな|name_kana/i, sanitizer: (v, s) => sanitizeName(v, s) },
  { match: /^カナ$|会員かな/i, sanitizer: (v, s) => sanitizeName(v, s) },
  // 氏名・実名系
  { match: /実質名義人|real_name|本名/i, sanitizer: (v, s) => sanitizeName(v, s) },
  // 一般氏名・担当者・関係者氏名
  {
    match: /氏名|会員名|担当者|永久担当|申込獲得者|name|Name(?!Of)|owner|created_by|担当顧客|働くDBユーザ|営業担当候補|申込獲得者対象|紹介者|代理人|連絡先氏名/i,
    sanitizer: (v, s) => sanitizeName(v, s),
  },
  // メール
  { match: /メール|Email|email|Eメール/i, sanitizer: (v, s) => sanitizeEmail(v, s) },
  // 電話
  { match: /電話|TEL|tel|phone|携帯/i, sanitizer: (v, s) => sanitizePhone(v, s) },
  // 住所
  { match: /住所|address|所在地/i, sanitizer: (v) => sanitizeAddress(v) },
  // 郵便番号
  { match: /郵便番号|postal_code|zip/i, sanitizer: (v) => sanitizePostalCode(v) },
  // 生年月日
  { match: /生年月日|誕生日|birthdate/i, sanitizer: (v) => sanitizeBirthdate(v) },
  // 自由記述コメント
  { match: /Description|description|備考|コメント|Comment|comment/i, sanitizer: (v) => sanitizeFreeText(v) },
];

function findSanitizer(column: string): ((val: string, seq: number) => string) | null {
  for (const p of SANITIZE_PATTERNS) {
    if (p.match.test(column)) return p.sanitizer;
  }
  return null;
}

function sanitizeRow(row: Record<string, string>, seq: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    const s = findSanitizer(k);
    out[k] = s ? s(v, seq) : v;
  }
  return out;
}

// ============================================================================
// ファイル名マッピング
// ============================================================================
interface FileSpec {
  inputName: string;
  outputName: string;
  configKey: keyof SampleConfig;
  label: string;
}

const FILES: FileSpec[] = [
  { inputName: 'user.csv',           outputName: 'User2.csv',         configKey: 'users',        label: 'users' },
  { inputName: 'KAWARA版関連.csv',    outputName: 'KAWARA版関連.csv',   configKey: 'inquiries',    label: 'inquiries (KAWARA)' },
  { inputName: '機密保持・CP.csv',     outputName: '機密保持_CP.csv',    configKey: 'inquiries',    label: 'inquiries (機密保持)' },
  { inputName: '会員情報.csv',         outputName: '会員情報.csv',       configKey: 'members',      label: 'members' },
  { inputName: '申し込み情報.csv',     outputName: '申し込み情報.csv',   configKey: 'applications', label: 'applications' },
  { inputName: '対応歴.csv',          outputName: 'extract.csv',       configKey: 'activities',   label: 'activities' },
];

async function processFile(spec: FileSpec, limit: number, outDir: string): Promise<{
  inputRows: number | null;
  outputRows: number;
} | null> {
  const sourceDir = resolve(process.cwd(), 'csv');
  const inputPath = resolve(sourceDir, spec.inputName);
  if (!existsSync(inputPath)) {
    console.log(`[SKIP] ${spec.label} (${spec.inputName} なし)`);
    return null;
  }
  const fileSize = statSync(inputPath).size;
  let headers: string[];
  let sampled: Record<string, string>[];
  let totalRows: number | null;
  if (fileSize >= STREAM_THRESHOLD_BYTES) {
    console.log(
      `[STREAM] ${spec.label} (${(fileSize / 1024 / 1024).toFixed(1)} MB) 読込...`,
    );
    const r = await streamHeadCsv(inputPath, limit);
    headers = r.headers;
    sampled = r.rows;
    totalRows = r.totalRowsInFile;
  } else {
    const text = readFileSync(inputPath, 'utf-8');
    const r = parseCsv(text);
    headers = r.headers;
    sampled = r.rows.slice(0, limit);
    totalRows = r.rows.length;
  }
  const sanitized = sampled.map((r, i) => sanitizeRow(r, i + 1));
  const outputPath = resolve(outDir, spec.outputName);
  writeCsv(outputPath, headers, sanitized);
  return { inputRows: totalRows, outputRows: sanitized.length };
}

async function main(): Promise<void> {
  const overrides = parseArgs();
  const config: SampleConfig = { ...DEFAULT_CONFIG, ...overrides };
  const sourceDir = resolve(process.cwd(), 'csv');
  const outDir = resolve(sourceDir, '_dummy');
  if (!existsSync(sourceDir)) {
    console.error(`[ERROR] csv ディレクトリがありません: ${sourceDir}`);
    process.exit(1);
  }
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }
  console.log('=== CSV サンプル抽出 + サニタイズ (v3) ===');
  console.log(`入力: ${sourceDir}`);
  console.log(`出力: ${outDir}`);
  console.log('件数設定:', config);
  console.log('');
  let totalOutput = 0;
  for (const spec of FILES) {
    const result = await processFile(spec, config[spec.configKey], outDir);
    if (!result) continue;
    totalOutput += result.outputRows;
    const inputDisp = result.inputRows === null ? '(打切)' : result.inputRows.toLocaleString();
    console.log(
      `[OK] ${spec.label.padEnd(27)} 元=${inputDisp.padStart(11)} 件 → 出力=${result.outputRows.toLocaleString().padStart(7)} 件`,
    );
  }
  console.log('');
  console.log(`合計出力: ${totalOutput.toLocaleString()} 件`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
