/**
 * 大規模CSVを行単位でストリーミング読込するパーサ。
 * 仕様書 §3 / §6 Phase 3: 活動履歴 120 万件規模に対応。
 *
 * 設計:
 *   - createReadStream + readline で行を取得
 *   - ヘッダ行は最初に1度だけ解析
 *   - クォート内に改行を含むセルに対応するため、内部バッファリングを行う
 *     (行をまたいで未閉じの " があれば次行と結合)
 *   - BOM 除去
 *   - 1行(=1レコード)が完成するたびにコールバックを呼ぶ
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export interface StreamCsvRow {
  [column: string]: string;
}

export interface StreamCsvOptions {
  delimiter?: string;
  trimValues?: boolean;
  encoding?: BufferEncoding;
}

/**
 * 1行のCSVセルを切り出す(クォート対応、エスケープ "" 対応)。
 * 入力は1レコード(=論理行)分の完成した文字列を想定。
 */
function parseRecord(record: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = record.length;
  while (i < len) {
    const ch = record[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (record[i + 1] === '"') {
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
    if (ch === delimiter) {
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

/**
 * 文字列内の "" 以外の " の数(クォート開閉状態判定)
 */
function countUnescapedQuotes(line: string): number {
  let count = 0;
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      if (line[i + 1] === '"') {
        i += 2;
        continue;
      }
      count++;
      i++;
      continue;
    }
    i++;
  }
  return count;
}

/**
 * 大規模CSVを行単位でコールバック処理する。
 * 戻り値: 処理した行数(ヘッダ除く)
 */
export async function streamCsv(
  filepath: string,
  onRow: (row: StreamCsvRow, index: number) => Promise<void> | void,
  options: StreamCsvOptions = {},
): Promise<number> {
  const { delimiter = ',', trimValues = false, encoding = 'utf-8' } = options;

  const stream = createReadStream(filepath, { encoding });
  const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });

  let headers: string[] | null = null;
  let buffer = ''; // クォート内改行を結合するバッファ
  let inOpenQuote = false;
  let processed = 0;
  let isFirstLine = true;

  for await (const rawLine of rl) {
    let line = rawLine;
    // 先頭行は BOM を除去
    if (isFirstLine) {
      if (line.charCodeAt(0) === 0xfeff) line = line.slice(1);
      isFirstLine = false;
    }

    // クォート未閉鎖を引き継いでいたら結合(CSV内改行)
    const combined = inOpenQuote ? `${buffer}\n${line}` : line;
    const quoteCount = countUnescapedQuotes(combined);
    if (quoteCount % 2 !== 0) {
      // まだ閉じていない → 次行に持ち越し
      buffer = combined;
      inOpenQuote = true;
      continue;
    }

    // 完成した1レコード
    buffer = '';
    inOpenQuote = false;
    const cells = parseRecord(combined, delimiter);

    if (!headers) {
      headers = cells.map((h) => h.trim());
      continue;
    }

    // 完全な空行はスキップ
    if (cells.length === 1 && cells[0] === '') continue;

    const obj: StreamCsvRow = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c] ?? `_col${c}`;
      let value = cells[c] ?? '';
      if (trimValues) value = value.trim();
      obj[key] = value;
    }

    await onRow(obj, processed);
    processed++;
  }

  // ファイル末で未閉鎖クォートが残っていたら警告として処理(無視するか拾うかは呼び出し側で)
  if (inOpenQuote && buffer && headers) {
    const cells = parseRecord(buffer, delimiter);
    const obj: StreamCsvRow = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c] ?? `_col${c}`;
      let value = cells[c] ?? '';
      if (trimValues) value = value.trim();
      obj[key] = value;
    }
    await onRow(obj, processed);
    processed++;
  }

  return processed;
}
