/**
 * 会員の案件別 利用額・出金額と累計入金額を、申込から計算する純粋関数(CLAUDE.md §5.4。2026-10-01)。
 * DB 側の recompute_member_amounts(migration 119)と同じ式。DB の結果をこの関数で照合する。
 *
 * - <キー>利用額 = ステータス「完了」の 入金額 + 資金移動額
 * - <キー>出金額 = ステータス「出金」の 出金額
 * - 累計入金額   = 全申込の 入金額 + 出金額 + 「完了」の資金移動額
 * - 既にあるキー(合計系を除く)で計算結果が 0 のものは "0"。無いキーは 0 なら作らない。
 */

export interface AppForAmount {
  project_id: string;
  status: string | null;
  payment_amount: number | string | null;
  withdrawal_amount: number | string | null;
  transfer_amount: number | string | null;
}

const num = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** 金額を extra に入れる文字列にする(小数部が 0 なら整数表記。CSV 取込の値と同じ形) */
export function amountText(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

/** 利用額・出金額のキーか(合計系は対象外) */
export function isProjectAmountKey(key: string): boolean {
  return /(利用額|出金額)$/.test(key) && !key.includes('合計');
}

/**
 * 計算後の extra を返す(他のキーはそのまま)。
 * @param keyByProjectId 案件ID → <キー>(member_amount_key か案件名)
 */
export function computeMemberAmounts(
  apps: readonly AppForAmount[],
  keyByProjectId: ReadonlyMap<string, string>,
  currentExtra: Readonly<Record<string, unknown>> | null | undefined,
): Record<string, unknown> {
  const usage = new Map<string, number>();
  const withdrawal = new Map<string, number>();
  let total = 0;
  for (const a of apps) {
    const key = keyByProjectId.get(a.project_id);
    const pay = num(a.payment_amount);
    const wd = num(a.withdrawal_amount);
    const tr = num(a.transfer_amount);
    total += pay + wd + (a.status === '完了' ? tr : 0);
    if (!key) continue;
    if (a.status === '完了') usage.set(key, (usage.get(key) ?? 0) + pay + tr);
    if (a.status === '出金') withdrawal.set(key, (withdrawal.get(key) ?? 0) + wd);
  }
  const out: Record<string, unknown> = { ...(currentExtra ?? {}) };
  // 既にあるキーはいったん 0 にしてから計算結果で上書き
  for (const k of Object.keys(out)) if (isProjectAmountKey(k)) out[k] = '0';
  for (const [k, v] of usage) if (v !== 0) out[`${k}利用額`] = amountText(v);
  for (const [k, v] of withdrawal) if (v !== 0) out[`${k}出金額`] = amountText(v);
  if (total !== 0 || '累計入金額' in out) out.累計入金額 = amountText(total);
  return out;
}
