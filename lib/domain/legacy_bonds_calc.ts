/**
 * 旧社債管理の計算・継続(CLAUDE.md §5.13c「編集・自動計算・次の期の自動作成」。migration 130)。純粋関数。
 *
 * 担当者の回答(2026-10-21)と本番 46 件の照合で確かめた Salesforce の運用:
 *   - 利息 = 前回継続元金 × 前回継続利息(年)% × 前回継続年数(単利。1 円未満切り捨て)
 *   - 源泉税 = 利息 × 20.315%(1 円未満切り捨て。海外法人名義は 0 円)
 *   - 償還金額 = 前回継続元金 + 利息 − 源泉税(税引き後の受取額)
 *   - 継続年数と利率: 1 年 15% / 2 年 20% / 3 年 25% / 5 年 30% / 8 年 35%
 *   - 次の期: 元金 = 償還金額(一部継続なら 償還金額 − 一部償還金額)、満期 = 今回の月 + 年数 + 1 か月
 */

/** 継続年数 → 利率(年 %)。担当者確認済み(2026-10-21 時点で有効) */
export const LEGACY_BOND_RATES: Readonly<Record<number, number>> = {
  1: 15,
  2: 20,
  3: 25,
  5: 30,
  8: 35,
};
export const LEGACY_BOND_YEAR_OPTIONS = [1, 2, 3, 5, 8] as const;

/** 源泉税率 20.315%(10 万分率で持ち、整数で計算する) */
const WITHHOLDING_PER_100K = 20_315;

/** 今回の結果の選択肢。空(null)は満期前 */
export const LEGACY_BOND_RESULTS = [
  '全額継続',
  '一部継続',
  '全額償還',
  '回答待ち',
  '回答待ち（未）',
] as const;
export type LegacyBondResult = (typeof LEGACY_BOND_RESULTS)[number];
/** 次の期を作る結果 */
const CONTINUE_RESULTS: readonly string[] = ['全額継続', '一部継続'];
/** まだ回答が決まっていない結果(一覧で目立たせる対象) */
const OPEN_RESULTS: readonly (string | null)[] = [null, '', '回答待ち', '回答待ち（未）'];

export function isContinueResult(result: string | null | undefined): boolean {
  return CONTINUE_RESULTS.includes(result ?? '');
}

/** 金額を 1 円単位の整数で扱う(numeric(18,2) の値が小数で来ても誤差を出さない) */
function toSen(v: number): number {
  return Math.round(v * 100);
}

export function computeLegacyBondAmounts(input: {
  principal: number;
  years: number;
  ratePercent: number;
  exempt: boolean;
}): { interest: number; withholdingTax: number; redemptionAmount: number } {
  // 元金(銭)× 利率(1/100 %)× 年数 ÷ 10^6 = 利息(円)。整数どうしの掛け算で浮動小数の誤差を避ける
  const interest = Math.floor(
    (toSen(input.principal) * toSen(input.ratePercent) * input.years) / 1_000_000,
  );
  const withholdingTax = input.exempt ? 0 : Math.floor((interest * WITHHOLDING_PER_100K) / 100_000);
  const redemptionAmount = toSen(input.principal) / 100 + interest - withholdingTax;
  return { interest, withholdingTax, redemptionAmount };
}

/** "YYYY/MM" に n か月足す。形式が違えば null */
export function addMonthsToYm(ym: string | null | undefined, months: number): string | null {
  const m = /^(\d{4})\/(\d{2})$/.exec(ym ?? '');
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const total = Number(m[1]) * 12 + (month - 1) + months;
  return `${Math.floor(total / 12)}/${String((total % 12) + 1).padStart(2, '0')}`;
}

/** 次の満期 = 今回の月 + 年数 + 1 か月(満期月の翌月から新しい期間が始まる。担当者確認済み) */
export function nextRedemptionMonth(ym: string | null | undefined, years: number): string | null {
  return addMonthsToYm(ym, years * 12 + 1);
}

/** 次の期を作るのに使う行の項目 */
export interface LegacyBondForCalc {
  member_id: string | null;
  member_name: string | null;
  application_no: string | null;
  application_id: string | null;
  project_name: string | null;
  project_id: string | null;
  bond_name: string | null;
  payment_amount: number | null;
  redemption_month: string | null;
  redemption_amount: number | null;
  prev_principal: number | null;
  prev_years: number | null;
  prev_interest_rate: number | null;
  result: string | null;
  partial_continue_amount: number | null;
  partial_redemption_amount: number | null;
  bank_info: string | null;
  withholding_exempt: boolean;
  next_bond_id: string | null;
}

export interface NextLegacyBondRow {
  member_id: string | null;
  member_name: string | null;
  application_no: string | null;
  application_id: string | null;
  project_name: string | null;
  project_id: string | null;
  bond_name: string | null;
  payment_amount: number | null;
  bank_info: string | null;
  withholding_exempt: boolean;
  redemption_month: string;
  prev_principal: number;
  prev_years: number;
  prev_interest_rate: number;
  interest: number;
  withholding_tax: number;
  redemption_amount: number;
  result: null;
}

/** 継続したときの次の期の元金(全額継続 = 償還金額 / 一部継続 = 一部継続金額) */
function continuationPrincipal(cur: LegacyBondForCalc): number | null {
  if (cur.redemption_amount == null) return null;
  if (cur.result === '一部継続') {
    if (cur.partial_continue_amount != null) return Number(cur.partial_continue_amount);
    if (cur.partial_redemption_amount != null)
      return Number(cur.redemption_amount) - Number(cur.partial_redemption_amount);
    return null;
  }
  return Number(cur.redemption_amount);
}

export function planNextLegacyBond(
  cur: LegacyBondForCalc,
  years: number,
): { row?: NextLegacyBondRow; error?: string } {
  if (!isContinueResult(cur.result))
    return { error: '今回の結果が「全額継続」か「一部継続」のときだけ次の期を作れます' };
  if (cur.next_bond_id) return { error: `次の期は作成済みです(${cur.next_bond_id})` };
  const rate = LEGACY_BOND_RATES[years];
  if (rate === undefined) return { error: '継続年数は 1・2・3・5・8 年から選んでください' };
  const principal = continuationPrincipal(cur);
  if (principal == null || principal <= 0)
    return { error: '次の期の元金が決まりません(償還金額・一部償還金額を確認してください)' };
  const month = nextRedemptionMonth(cur.redemption_month, years);
  if (!month) return { error: '償還対象月(YYYY/MM)が入っていないため、次の満期を決められません' };
  const amounts = computeLegacyBondAmounts({
    principal,
    years,
    ratePercent: rate,
    exempt: cur.withholding_exempt,
  });
  return {
    row: {
      member_id: cur.member_id,
      member_name: cur.member_name,
      application_no: cur.application_no,
      application_id: cur.application_id,
      project_name: cur.project_name,
      project_id: cur.project_id,
      bond_name: cur.bond_name,
      payment_amount: cur.payment_amount,
      bank_info: cur.bank_info,
      withholding_exempt: cur.withholding_exempt,
      redemption_month: month,
      prev_principal: principal,
      prev_years: years,
      prev_interest_rate: rate,
      interest: amounts.interest,
      withholding_tax: amounts.withholdingTax,
      redemption_amount: amounts.redemptionAmount,
      result: null,
    },
  };
}

/** 編集画面から来る値(入力欄の文字列のまま) */
export interface LegacyBondEditInput {
  result: string;
  prevPrincipal: string;
  prevYears: string;
  prevInterestRate: string;
  withholdingExempt: boolean;
  partialRedemptionAmount: string;
  contractSentDate: string;
  bankInfo: string;
}

export interface LegacyBondPatch {
  result?: string | null;
  prev_principal?: number;
  prev_years?: number;
  prev_interest_rate?: number;
  withholding_exempt?: boolean;
  interest?: number;
  withholding_tax?: number;
  redemption_amount?: number;
  partial_continue_amount?: number | null;
  partial_redemption_amount?: number | null;
  contract_sent_date: string | null;
  bank_info: string | null;
}

function parseAmount(v: string, label: string): { value?: number; error?: string } {
  const s = (v ?? '').replace(/[,，¥￥\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { error: `${label}は 0 以上の数字で入力してください` };
  return { value: Number(s) };
}

/**
 * 編集の保存内容を作る。利息・源泉税・償還金額・一部継続金額は入力から計算し直す。
 * 次の期を作成済みの行は、次の期の元金と食い違わないよう金額・結果・源泉徴収なしを変えさせない(契約書送付日・銀行情報だけ)。
 */
export function buildLegacyBondPatch(
  cur: LegacyBondForCalc,
  input: LegacyBondEditInput,
): { patch?: LegacyBondPatch; error?: string } {
  const result = (input.result ?? '').trim();
  if (result && !(LEGACY_BOND_RESULTS as readonly string[]).includes(result))
    return { error: '今回の結果は選択肢から選んでください' };
  const date = (input.contractSentDate ?? '').trim();
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return { error: '契約書送付日の形式が正しくありません' };
  const bankInfo = (input.bankInfo ?? '').trim();
  if (bankInfo.length > 2000) return { error: '銀行情報は 2,000 文字までです' };

  const principal = parseAmount(input.prevPrincipal, '前回継続元金');
  if (principal.error) return { error: principal.error };
  const yearsStr = (input.prevYears ?? '').trim();
  if (!/^\d{1,2}$/.test(yearsStr) || Number(yearsStr) < 1)
    return { error: '前回継続年数は 1 以上の整数で入力してください' };
  const years = Number(yearsStr);
  const rate = parseAmount(input.prevInterestRate, '前回継続利息（年）');
  if (rate.error) return { error: rate.error };
  const exempt = input.withholdingExempt === true;
  const partialStr = (input.partialRedemptionAmount ?? '').trim();

  const common = { contract_sent_date: date || null, bank_info: bankInfo || null };

  if (cur.next_bond_id) {
    const same =
      (result || null) === (cur.result || null) &&
      Number(principal.value) === Number(cur.prev_principal) &&
      years === Number(cur.prev_years) &&
      Number(rate.value) === Number(cur.prev_interest_rate) &&
      exempt === cur.withholding_exempt &&
      (partialStr === '' ? null : Number(partialStr.replace(/[,，¥￥\s]/g, ''))) ===
        (cur.partial_redemption_amount == null ? null : Number(cur.partial_redemption_amount));
    if (!same)
      return {
        error: `次の期(${cur.next_bond_id})を作成済みのため、金額・今回の結果・源泉徴収なしは変更できません(契約書送付日・銀行情報は変更できます)`,
      };
    return { patch: common };
  }

  const amounts = computeLegacyBondAmounts({
    principal: Number(principal.value),
    years,
    ratePercent: Number(rate.value),
    exempt,
  });

  let partialRedemption: number | null = null;
  let partialContinue: number | null = null;
  if (result === '一部継続') {
    const pr = parseAmount(partialStr, '一部償還金額');
    if (pr.error) return { error: '一部継続のときは一部償還金額を入力してください' };
    if (Number(pr.value) <= 0 || Number(pr.value) >= amounts.redemptionAmount)
      return { error: '一部償還金額は 0 円より大きく、償還金額より小さい額にしてください' };
    partialRedemption = Number(pr.value);
    partialContinue = amounts.redemptionAmount - partialRedemption;
  }

  return {
    patch: {
      ...common,
      result: result || null,
      prev_principal: Number(principal.value),
      prev_years: years,
      prev_interest_rate: Number(rate.value),
      withholding_exempt: exempt,
      interest: amounts.interest,
      withholding_tax: amounts.withholdingTax,
      redemption_amount: amounts.redemptionAmount,
      partial_redemption_amount: partialRedemption,
      partial_continue_amount: partialContinue,
    },
  };
}

/**
 * 一覧で目立たせる行。回答が決まっていない(空・回答待ち・回答待ち（未）)もののうち、
 * 満期を過ぎたものは「期限切れ」、今月から 2 か月以内に満期のものは「間近」。
 */
export function legacyBondAttention(
  row: { redemption_month: string | null; result: string | null },
  currentYm: string,
): 'overdue' | 'soon' | null {
  if (!OPEN_RESULTS.includes(row.result)) return null;
  const ym = row.redemption_month;
  if (!ym || !/^\d{4}\/\d{2}$/.test(ym)) return null;
  if (ym < currentYm) return 'overdue';
  const limit = addMonthsToYm(currentYm, 2);
  if (limit && ym <= limit) return 'soon';
  return null;
}
