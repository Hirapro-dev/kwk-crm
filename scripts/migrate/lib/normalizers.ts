/**
 * 移行スクリプト共通: 値の正規化(電話番号、日時、空文字、Boolean等)
 * 仕様書 §6.3 データクレンジング規則
 */

/**
 * 空文字を null に。前後空白除去も実施。
 */
export function nz(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const t = value.trim();
  return t === '' ? null : t;
}

/**
 * 電話番号フィールドから「架電NG」等のフラグ文字列を抽出。
 * 仕様書 §6.3:
 *   '08034396967架電NG' → phone='08034396967', do_not_call=true
 * 電話番号として数字のみを残す(ハイフン等は除去)。
 */
export interface PhoneResult {
  phone: string | null;
  doNotCall: boolean;
  originalIfFlagged: string | null;
}

const DO_NOT_CALL_FLAGS = ['架電NG', '電話NG', 'TELNG', 'TelNG', 'tel ng', 'NG'];

export function normalizePhone(raw: string | null | undefined): PhoneResult {
  if (!raw) return { phone: null, doNotCall: false, originalIfFlagged: null };
  const trimmed = raw.trim();
  if (!trimmed) return { phone: null, doNotCall: false, originalIfFlagged: null };

  let doNotCall = false;
  let work = trimmed;
  for (const flag of DO_NOT_CALL_FLAGS) {
    if (work.includes(flag)) {
      doNotCall = true;
      work = work.replace(flag, '');
    }
  }

  // 数字とハイフン以外を除去 → さらにハイフンを除去
  const digitsOnly = work.replace(/[^0-9]/g, '');

  return {
    phone: digitsOnly === '' ? null : digitsOnly,
    doNotCall,
    originalIfFlagged: doNotCall ? trimmed : null,
  };
}

/**
 * 日本語日時 → ISO 文字列。失敗時 null。
 * 仕様書 §6.3: '2018/7/24 22:06' 等を正規化、失敗は extra.original_registered_at に保存
 *
 * 対応フォーマット:
 *   - 2018/7/24 22:06
 *   - 2018/07/24 22:06:30
 *   - 2018-07-24 22:06
 *   - 2018年7月24日 22時06分
 *   - 2018/7/24
 */
export function parseJpDateTime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 「年/月/日」形式
  const m1 = trimmed.match(
    /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/,
  );
  if (m1) {
    const [, y, mo, d, h, mi, s] = m1;
    return buildIso(y!, mo!, d!, h, mi, s);
  }

  // 「年月日」漢字形式
  const m2 = trimmed.match(
    /^(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s*(\d{1,2})時(\d{1,2})分(?:(\d{1,2})秒)?)?$/,
  );
  if (m2) {
    const [, y, mo, d, h, mi, s] = m2;
    return buildIso(y!, mo!, d!, h, mi, s);
  }

  // 標準 ISO ならそのまま Date 経由
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  return null;
}

function buildIso(
  y: string,
  mo: string,
  d: string,
  h?: string,
  mi?: string,
  s?: string,
): string | null {
  const yy = Number.parseInt(y, 10);
  const mm = Number.parseInt(mo, 10);
  const dd = Number.parseInt(d, 10);
  const hh = h ? Number.parseInt(h, 10) : 0;
  const mn = mi ? Number.parseInt(mi, 10) : 0;
  const ss = s ? Number.parseInt(s, 10) : 0;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  // JST(+09:00) として解釈する想定。データ仕様に応じて変更可。
  const pad2 = (n: number) => n.toString().padStart(2, '0');
  return `${yy.toString().padStart(4, '0')}-${pad2(mm)}-${pad2(dd)}T${pad2(hh)}:${pad2(mn)}:${pad2(ss)}+09:00`;
}

/**
 * 日付のみ → 'YYYY-MM-DD' 形式 or null
 */
export function parseJpDate(raw: string | null | undefined): string | null {
  const iso = parseJpDateTime(raw);
  if (!iso) return null;
  return iso.slice(0, 10);
}

/**
 * 数値(カンマ・通貨記号除去)。失敗時 null。
 */
export function parseAmount(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw)
    .replace(/[¥,円\s]/g, '')
    .trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Boolean系: 'true'/'1'/'はい'/'YES'/'有' などを true、それ以外を false
 */
export function parseBool(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const t = raw.trim().toLowerCase();
  return (
    t === 'true' ||
    t === '1' ||
    t === 'yes' ||
    t === 'y' ||
    t === 'はい' ||
    t === '有' ||
    t === '○' ||
    t === '〇'
  );
}

/**
 * メールアドレス正規化(空文字 → null、前後空白除去)。
 * バリデーションは行わない(壊れたメールも保持する)。
 */
export function normalizeEmail(raw: string | null | undefined): string | null {
  return nz(raw);
}
