/**
 * 移行スクリプト共通: 環境変数読込
 * 仕様書 §13
 */

import { config } from 'node:process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * .env.local を最優先で読み込む。
 * dotenv を入れずに最小実装で行う(依存追加を避ける)。
 */
function loadDotEnv(filename: string): void {
  const filepath = resolve(process.cwd(), filename);
  if (!existsSync(filepath)) return;
  const content = readFileSync(filepath, 'utf-8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // 両端のクォート除去
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnv('.env.local');
loadDotEnv('.env');

export interface MigrateEnv {
  supabaseUrl: string;
  serviceRoleKey: string;
  sourceDir: string;
  errorDir: string;
}

export function getEnv(): MigrateEnv {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sourceDir = process.env.MIGRATE_SOURCE_DIR ?? './csv';
  const errorDir = process.env.MIGRATE_ERROR_DIR ?? './errors';

  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL が設定されていません(.env.local)');
  }
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY が設定されていません(.env.local)');
  }

  return {
    supabaseUrl,
    serviceRoleKey,
    sourceDir,
    errorDir,
  };
}
