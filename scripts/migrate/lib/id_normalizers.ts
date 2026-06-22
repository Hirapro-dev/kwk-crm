/**
 * 既存ID(K-/M-/TA-)の正規化(仕様書 §4.1)
 *
 * 入力のばらつき:
 *   "K0012345"  / "K-12345"  / "12345"      → "K-0012345"
 *   "M0012345"  / "M-12345"                  → "M-0012345"
 *   "TA0012345" / "TA-12345" / "TA00012345" → "TA-0012345"
 */

function pad7(digits: string): string {
  return digits.padStart(7, '0').slice(-7);
}

function buildId(prefix: 'K' | 'M' | 'TA', raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().toUpperCase();
  if (!s) return null;
  // 既に正規形(TAは2文字なので分けて評価)
  if (prefix === 'TA' && /^TA-\d{7}$/.test(s)) return s;
  if ((prefix === 'K' || prefix === 'M') && new RegExp(`^${prefix}-\\d{7}$`).test(s)) return s;

  const digits = s.replace(/\D/g, '');
  if (!digits) return null;
  return `${prefix}-${pad7(digits)}`;
}

export function normalizeMemberId(raw: string | null | undefined): string | null {
  return buildId('K', raw);
}

export function normalizeApplicationId(raw: string | null | undefined): string | null {
  return buildId('M', raw);
}

export function normalizeInquiryId(raw: string | null | undefined): string | null {
  return buildId('TA', raw);
}
