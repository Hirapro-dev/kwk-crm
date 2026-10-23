'use client';

/**
 * 旧社債管理の「編集」(CLAUDE.md §5.13c。admin のみ)。
 * 利息・源泉税・償還金額・一部継続金額は入力から自動で計算し、ダイアログ内で結果を見せてから保存する
 * (保存時もサーバーで同じ純粋関数で計算し直す)。次の期を作成済みの行は金額・結果を変えられない。
 */

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { updateLegacyBond } from '@/lib/domain/legacy_bond_actions';
import type { LegacyBondRow } from '@/lib/domain/legacy_bonds';
import {
  LEGACY_BOND_RATES,
  LEGACY_BOND_RESULTS,
  computeLegacyBondAmounts,
} from '@/lib/domain/legacy_bonds_calc';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

const yen = (n: number) => `¥${n.toLocaleString()}`;
const str = (v: number | null | undefined) =>
  v === null || v === undefined ? '' : String(Number(v));

export function LegacyBondEditDialog({ bond }: { bond: LegacyBondRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const initial = () => ({
    result: bond.result ?? '',
    prevPrincipal: str(bond.prev_principal),
    prevYears: str(bond.prev_years),
    prevInterestRate: str(bond.prev_interest_rate),
    withholdingExempt: bond.withholding_exempt,
    partialRedemptionAmount: str(bond.partial_redemption_amount),
    contractSentDate: bond.contract_sent_date ?? '',
    bankInfo: bond.bank_info ?? '',
  });
  const [form, setForm] = useState(initial);
  const locked = Boolean(bond.next_bond_id);

  const principal = Number(form.prevPrincipal.replace(/[,\s]/g, ''));
  const years = Number(form.prevYears);
  const rate = Number(form.prevInterestRate);
  const valid =
    principal >= 0 &&
    Number.isInteger(years) &&
    years >= 1 &&
    rate >= 0 &&
    form.prevPrincipal !== '';
  const calc = valid
    ? computeLegacyBondAmounts({
        principal,
        years,
        ratePercent: rate,
        exempt: form.withholdingExempt,
      })
    : null;
  const partial = Number(form.partialRedemptionAmount.replace(/[,\s]/g, ''));
  const resultOptions = (LEGACY_BOND_RESULTS as readonly string[]).includes(bond.result ?? '')
    ? LEGACY_BOND_RESULTS
    : [...LEGACY_BOND_RESULTS, ...(bond.result ? [bond.result] : [])];

  const save = () => {
    setError(null);
    startTransition(async () => {
      const r = await updateLegacyBond(bond.id, form);
      if (r.error) {
        setError(r.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  const set = <K extends keyof ReturnType<typeof initial>>(
    k: K,
    v: ReturnType<typeof initial>[K],
  ) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setForm(initial());
          setError(null);
          setOpen(true);
        }}
      >
        編集
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent
          className="max-w-[95%] sm:max-w-[640px]"
          onClose={() => !pending && setOpen(false)}
        >
          <DialogHeader>
            <DialogTitle>旧社債管理の編集({bond.id})</DialogTitle>
            {locked && (
              <p className="mt-1 text-xs text-amber-700">
                次の期({bond.next_bond_id}
                )を作成済みのため、金額・今回の結果・源泉徴収なしは変更できません。
              </p>
            )}
          </DialogHeader>
          <div className="grid gap-3 text-xs sm:grid-cols-2">
            <label htmlFor="lb-result" className="block">
              今回の結果 id="lb-result"{' '}
              <Select
                className="mt-1"
                value={form.result}
                disabled={pending || locked}
                onChange={(e) => set('result', e.target.value)}
              >
                <option value="">(未入力・満期前)</option>
                {resultOptions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </label>
            <label htmlFor="lb-contract" className="block">
              契約書送付 id="lb-contract"日
              <Input
                className="mt-1"
                type="date"
                value={form.contractSentDate}
                disabled={pending}
                onChange={(e) => set('contractSentDate', e.target.value)}
              />
            </label>
            <label htmlFor="lb-principal" className="block">
              前回継続元金( id="lb-principal"円)
              <Input
                className="mt-1"
                inputMode="numeric"
                value={form.prevPrincipal}
                disabled={pending || locked}
                onChange={(e) => set('prevPrincipal', e.target.value)}
              />
            </label>
            <label htmlFor="lb-years" className="block">
              前回継続年数(年) id="lb-years"{' '}
              <Input
                className="mt-1"
                inputMode="numeric"
                value={form.prevYears}
                disabled={pending || locked}
                onChange={(e) => {
                  const y = e.target.value;
                  const r = LEGACY_BOND_RATES[Number(y)];
                  // 表にある年数を入れたら利率も表の値にする(古い条件の行は手で直せる)
                  setForm((f) => ({
                    ...f,
                    prevYears: y,
                    ...(r !== undefined ? { prevInterestRate: String(r) } : {}),
                  }));
                }}
              />
            </label>
            <label htmlFor="lb-rate" className="block">
              前回継続利息(年 %) id="lb-rate"{' '}
              <Input
                className="mt-1"
                inputMode="decimal"
                value={form.prevInterestRate}
                disabled={pending || locked}
                onChange={(e) => set('prevInterestRate', e.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 pt-5">
              <input
                type="checkbox"
                checked={form.withholdingExempt}
                disabled={pending || locked}
                onChange={(e) => set('withholdingExempt', e.target.checked)}
              />
              源泉徴収なし(海外法人名義)
            </label>
            {form.result === '一部継続' && (
              <label htmlFor="lb-partial" className="block">
                一部償還金額(払い出す額。円) id="lb-partial"{' '}
                <Input
                  className="mt-1"
                  inputMode="numeric"
                  value={form.partialRedemptionAmount}
                  disabled={pending || locked}
                  onChange={(e) => set('partialRedemptionAmount', e.target.value)}
                />
              </label>
            )}
            <label htmlFor="lb-bank" className="block sm:col-span-2">
              銀行情報 id="lb-bank"{' '}
              <Textarea
                className="mt-1"
                rows={3}
                value={form.bankInfo}
                disabled={pending}
                onChange={(e) => set('bankInfo', e.target.value)}
              />
            </label>
          </div>
          <div className="mt-3 rounded border bg-gray-50 p-2 text-xs">
            <div className="mb-1 text-muted-foreground">自動計算(1 円未満切り捨て)</div>
            {calc ? (
              <dl className="grid grid-cols-[8rem_1fr] gap-y-0.5">
                <dt>利息</dt>
                <dd>{yen(calc.interest)}</dd>
                <dt>源泉税</dt>
                <dd>
                  {yen(calc.withholdingTax)}
                  {form.withholdingExempt && (
                    <span className="ml-1 text-muted-foreground">(源泉徴収なし)</span>
                  )}
                </dd>
                <dt>償還金額</dt>
                <dd className="font-semibold">{yen(calc.redemptionAmount)}</dd>
                {form.result === '一部継続' && partial > 0 && (
                  <>
                    <dt>一部継続金額</dt>
                    <dd className="font-semibold">
                      {yen(calc.redemptionAmount - partial)}(次の期の元金)
                    </dd>
                  </>
                )}
              </dl>
            ) : (
              <p className="text-muted-foreground">元金・年数・利率を入れると計算します</p>
            )}
          </div>
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          <DialogFooter>
            <Button variant="outline" size="sm" disabled={pending} onClick={() => setOpen(false)}>
              キャンセル
            </Button>
            <Button size="sm" disabled={pending} onClick={save}>
              {pending ? '保存中…' : '保存する'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
