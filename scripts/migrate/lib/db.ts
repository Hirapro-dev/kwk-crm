/**
 * 移行スクリプト用 Supabase クライアント。
 * 仕様書 §12.4: service_role キーはサーバー側のみ。
 *
 * Node.js 20 では WebSocket がグローバルに無いため、ws パッケージを transport として渡す。
 */

import { createClient } from '@supabase/supabase-js';
// biome-ignore lint/style/useNodejsImportProtocol: ws は npm パッケージ
import WebSocket from 'ws';
import { getEnv } from './env';

// Supabase Realtime client は global の WebSocket を見るので、Node.js では ws を割り当てる
if (typeof globalThis.WebSocket === 'undefined') {
  // biome-ignore lint/suspicious/noExplicitAny: 型互換性回避
  (globalThis as any).WebSocket = WebSocket;
}

export function createMigrateClient() {
  const env = getEnv();
  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    db: {
      schema: 'public',
    },
  });
}

export type MigrateClient = ReturnType<typeof createMigrateClient>;
