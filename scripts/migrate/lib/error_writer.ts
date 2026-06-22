/**
 * 移行スクリプト共通: エラーレコードを errors/ ディレクトリにCSV出力
 * 仕様書 §6.2
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toCsv, type CsvRow } from './csv';
import { getEnv } from './env';

export interface ErrorRecord extends CsvRow {
  _error: string;
}

export function writeErrors(filename: string, errors: ErrorRecord[]): string | null {
  if (errors.length === 0) return null;
  const env = getEnv();
  const dir = resolve(process.cwd(), env.errorDir);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const filepath = resolve(dir, filename);
  // 全カラム抽出(全行のキーを union)
  const cols = new Set<string>();
  for (const e of errors) {
    for (const k of Object.keys(e)) cols.add(k);
  }
  // _error は最後に
  cols.delete('_error');
  const headers = [...cols, '_error'];
  const csv = toCsv(errors, headers);
  writeFileSync(filepath, csv, 'utf-8');
  return filepath;
}
