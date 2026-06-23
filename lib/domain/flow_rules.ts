import { createClient } from '@/lib/supabase/server';

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

/** アクティブなルール一覧を sort_order 昇順で取得 */
export async function listFlowRules(): Promise<FlowRule[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('flow_rules')
    .select('*')
    .order('sort_order')
    .order('id');

  if (error) {
    console.error('[flow_rules] listFlowRules:', error.message);
    return [];
  }
  return (data ?? []) as FlowRule[];
}

/** s_bunrui に最もマッチするアクティブなフロールールを返す */
export async function findMatchingRule(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sBunrui: string | null | undefined,
): Promise<FlowRule | null> {
  if (!sBunrui) return null;

  const flags = sBunrui.split('|').map((s) => s.trim());
  if (flags.length === 0) return null;

  const { data, error } = await supabase
    .from('flow_rules')
    .select('*')
    .eq('is_active', true)
    .in('trigger_flag', flags)
    .order('sort_order')
    .order('id')
    .limit(flags.length);

  if (error || !data || data.length === 0) return null;

  const rules = data as FlowRule[];
  // flags の順番ではなく sort_order 優先でマッチした最初のルールを返す
  return rules[0] ?? null;
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
  // 計算結果が過去になる端ケース(duration_value=0かつ当日のリセット時刻を過ぎた場合)
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
