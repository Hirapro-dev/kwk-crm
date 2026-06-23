import { createClient } from '@/lib/supabase/server';
import type { FlowRule } from './flow_rules_types';

export type { DurationType, FlowRule } from './flow_rules_types';
export { calcExpiresAt, formatDuration } from './flow_rules_types';

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
  return rules[0] ?? null;
}
