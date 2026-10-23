'use client';

/**
 * 旧社債管理の「次の期を作成」(CLAUDE.md §5.13c。admin のみ)。
 * 今回の結果が「全額継続」「一部継続」で、まだ次の期が無い行に出す。継続年数を選ぶと、作られる行の中身(元金・満期・利率・金額)を
 * 先に見せてから作成する。計算は純粋関数 planNextLegacyBond(サーバーでも同じ関数で作る)。
 */

import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { continueLegacyBond } from '@/lib/domain/legacy_bond_actions';
import type { LegacyBondRow } from '@/lib/domain/legacy_bonds';
import {
  LEGACY_BOND_RATES,
  LEGACY_BOND_YEAR_OPTIONS,
  planNextLegacyBond,
} from '@/lib/domain/legacy_bonds_calc';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

const yen = (n: number) => `¥${n.toLocaleString()}`;

export function LegacyBondContinuePanel({ bond }: { bond: LegacyBondRow }) {
  const router = useRouter();
  const [years, setYears] = useState<number>(
    bond.prev_years && LEGACY_BOND_RATES[bond.prev_years] ? bond.prev_years : 1,
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const plan = planNextLegacyBond(bond, years);

  const create = () => {
    if (!plan.row) return;
    if (
      !window.confirm(
        `次の期(${plan.row.redemption_month} 満期・元金 ${yen(plan.row.prev_principal)}・${years} 年 ${plan.row.prev_interest_rate}%)を作成します。よろしいですか？`,
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      const r = await continueLegacyBond(bond.id, years);
      if (r.error || !r.nextId) {
        setError(r.error ?? '作成に失敗しました');
        return;
      }
      router.push(`/legacy-bonds/${r.nextId}`);
      router.refresh();
    });
  };

  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">継続年数</span>
        <Select
          aria-label="継続年数"
          className="w-36"
          value={String(years)}
          disabled={pending}
          onChange={(e) => setYears(Number(e.target.value))}
        >
          {LEGACY_BOND_YEAR_OPTIONS.map((y) => (
            <option key={y} value={y}>
              {y} 年(年 {LEGACY_BOND_RATES[y]}%)
            </option>
          ))}
        </Select>
        <Button size="sm" disabled={pending || !plan.row} onClick={create}>
          {pending ? '作成中…' : '次の期を作成'}
        </Button>
      </div>
      {plan.row ? (
        <dl className="grid grid-cols-[8rem_1fr] gap-y-0.5 rounded border bg-gray-50 p-2 text-xs">
          <dt>償還対象月</dt>
          <dd>
            {plan.row.redemption_month}(今回の月 + {years} 年 + 1 か月)
          </dd>
          <dt>前回継続元金</dt>
          <dd>
            {yen(plan.row.prev_principal)}
            <span className="ml-1 text-muted-foreground">
              ({bond.result === '一部継続' ? '一部継続金額' : '今回の償還金額'})
            </span>
          </dd>
          <dt>利息</dt>
          <dd>{yen(plan.row.interest)}</dd>
          <dt>源泉税</dt>
          <dd>
            {yen(plan.row.withholding_tax)}
            {plan.row.withholding_exempt && (
              <span className="ml-1 text-muted-foreground">(源泉徴収なし)</span>
            )}
          </dd>
          <dt>償還金額</dt>
          <dd className="font-semibold">{yen(plan.row.redemption_amount)}</dd>
        </dl>
      ) : (
        <p className="text-xs text-red-600">{plan.error}</p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
