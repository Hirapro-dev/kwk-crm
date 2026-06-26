import { createClient } from '@/lib/supabase/server';
import { type FlowRule, ruleAppliesToRole } from './flow_rules_types';

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

/**
 * s_bunrui に最もマッチするアクティブなフロールールを返す。
 * userRole を渡すと、そのロールに適用されるルールのみを対象にする
 * (apply_roles が null/空のルールは全ロールに適用)。
 */
export async function findMatchingRule(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sBunrui: string | null | undefined,
  userRole?: string | null,
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
    .order('id');

  if (error || !data || data.length === 0) return null;

  const rules = data as FlowRule[];
  // userRole 指定時は適用ロールで絞り込む(未指定なら従来どおり全件対象)
  const applicable =
    userRole === undefined ? rules : rules.filter((r) => ruleAppliesToRole(r, userRole));
  return applicable[0] ?? null;
}
