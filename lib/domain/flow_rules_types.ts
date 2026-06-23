/**
 * FlowRule の型定義と純粋ユーティリティ。
 * サーバー専用モジュールへの依存がないため、クライアントコンポーネントから安全にインポートできる。
 */

export type DurationType = 'days_at_time' | 'hours';

export interface FlowRule {
  id: number;
  name: string;
  trigger_flag: string;
  duration_type: DurationType;
  duration_value: number;
  reset_hour: number;
  reset_minute: number;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** 有効期限を計算する */
export function calcExpiresAt(rule: FlowRule): Date {
  const now = new Date();

  if (rule.duration_type === 'hours') {
    return new Date(now.getTime() + rule.duration_value * 60 * 60 * 1000);
  }

  // days_at_time: N日後の reset_hour:reset_minute JST
  const expires = new Date(now);
  expires.setDate(expires.getDate() + rule.duration_value);
  // JST → UTC: JST は UTC+9
  const utcHour = ((rule.reset_hour - 9) + 24) % 24;
  expires.setUTCHours(utcHour, rule.reset_minute, 0, 0);
  // 計算結果が過去になる端ケース
  if (expires <= now) {
    expires.setDate(expires.getDate() + 1);
  }
  return expires;
}

/** duration_type と値を日本語表記に変換 */
export function formatDuration(rule: FlowRule): string {
  if (rule.duration_type === 'hours') {
    return `${rule.duration_value}時間後`;
  }
  const h = String(rule.reset_hour).padStart(2, '0');
  const m = String(rule.reset_minute).padStart(2, '0');
  return `${rule.duration_value}日後の${h}:${m}`;
}
