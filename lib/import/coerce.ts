/**
 * CSV セル値の型変換 (取込用)。
 * 各関数は {value} か {error} を返す。空文字は基本的に null(主キー等の必須は呼び出し側で弾く)。
 */

import type { ImportFieldType } from './schema';

export interface CoerceOk {
  value: string | number | boolean | null;
}
export interface CoerceErr {
  error: string;
}
export type CoerceResult = CoerceOk | CoerceErr;

const pad = (n: string | number) => String(n).padStart(2, '0');

function coerceNumber(s: string): CoerceResult {
  const t = s.replace(/[,¥￥\s]/g, '');
  if (t === '') return { value: null };
  const n = Number(t);
  if (!Number.isFinite(n)) return { error: `数値として解釈できません: "${s}"` };
  return { value: n };
}

/**
 * 日付文字列を {y, mo, d} に解釈する。対応形式:
 *   - 年先頭: YYYY/M/D, YYYY-M-D, YYYY.M.D
 *   - 年末尾(米国式 月/日/年): M/D/YYYY, M/D/YY
 * 2桁年は Excel 互換で 00-29→2000年代 / 30-99→1900年代。
 * 月>12 かつ 日<=12 の場合は D/M とみなして入れ替える(防御的)。
 */
function parseYMD(t: string): { y: number; mo: number; d: number } | null {
  const norm = (y: number, mo: number, d: number) => {
    if (mo > 12 && d <= 12) {
      const tmp = mo;
      mo = d;
      d = tmp;
    }
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return { y, mo, d };
  };

  // 年先頭(4桁年)
  let m = t.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
  if (m) return norm(Number(m[1]), Number(m[2]), Number(m[3]));

  // 年末尾(米国式 月/日/年)
  m = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (m) {
    let y = Number(m[3]);
    if (m[3]!.length <= 2) y = y <= 29 ? 2000 + y : 1900 + y;
    return norm(y, Number(m[1]), Number(m[2]));
  }
  return null;
}

function coerceDate(s: string): CoerceResult {
  const t = s.trim();
  if (t === '') return { value: null };
  const ymd = parseYMD(t);
  if (!ymd) {
    return { error: `日付として解釈できません(YYYY/MM/DD または M/D/YY): "${s}"` };
  }
  return { value: `${ymd.y}-${pad(ymd.mo)}-${pad(ymd.d)}` };
}

function coerceDateTime(s: string): CoerceResult {
  const t = s.trim();
  if (t === '') return { value: null };
  const ymd = parseYMD(t);
  if (!ymd) {
    return { error: `日時として解釈できません(YYYY/MM/DD HH:mm または M/D/YY): "${s}"` };
  }
  // 日付の後ろにある時刻(H:mm[:ss])を抽出(無ければ 00:00:00)
  const tm = t.match(/[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  const h = tm ? tm[1]! : '0';
  const mi = tm ? tm[2]! : '0';
  const se = tm?.[3] ?? '0';
  return {
    value: `${ymd.y}-${pad(ymd.mo)}-${pad(ymd.d)}T${pad(h)}:${pad(mi)}:${pad(se)}`,
  };
}

function coerceBoolean(s: string): CoerceResult {
  const t = s.trim();
  if (t === '') return { value: null };
  if (/^(1|true|yes|y|はい|有効|on|○|◯|✓)$/i.test(t)) return { value: true };
  if (/^(0|false|no|n|いいえ|無効|off|×|✕)$/i.test(t)) return { value: false };
  return { error: `真偽値として解釈できません(1/0, はい/いいえ 等): "${s}"` };
}

function coerceText(s: string): CoerceResult {
  const t = s.trim();
  return { value: t === '' ? null : t };
}

export function coerceValue(type: ImportFieldType, raw: string): CoerceResult {
  switch (type) {
    case 'number':
      return coerceNumber(raw);
    case 'date':
      return coerceDate(raw);
    case 'datetime':
      return coerceDateTime(raw);
    case 'boolean':
      return coerceBoolean(raw);
    default:
      return coerceText(raw);
  }
}

export function isCoerceErr(r: CoerceResult): r is CoerceErr {
  return 'error' in r;
}
