/**
 * 申込の一覧・詳細で、値に単位を付けて表示する(2026-10-02 ユーザー指定)。純粋関数。
 * 項目名には単位を入れず(「利息」「契約期間」)、セルの値だけに付ける。入力・編集は数字のまま。
 *   - 利息(interest)      → 「0.01%」
 *   - 契約期間(contract_period。月数) → 「4ヶ月」
 */

const UNIT_SUFFIX: Readonly<Record<string, string>> = {
  interest: '%',
  contract_period: 'ヶ月',
};

/**
 * 単位を付ける項目なら表示用の文字列を返す(値が空なら '-')。対象外の項目は null(呼び出し側の通常の表示に任せる)。
 * 数字として読めない値(古いデータの自由入力など)は、単位を重ねないようそのまま返す。
 */
export function formatApplicationUnitValue(fieldName: string, raw: unknown): string | null {
  const unit = UNIT_SUFFIX[fieldName];
  if (!unit) return null;
  if (raw === null || raw === undefined || String(raw).trim() === '') return '-';
  const text = String(raw).trim();
  const n = Number(text.replace(/,/g, ''));
  if (!Number.isFinite(n)) return text;
  return `${new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 4 }).format(n)}${unit}`;
}
