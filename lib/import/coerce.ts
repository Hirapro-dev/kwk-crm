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

function coerceDate(s: string): CoerceResult {
  const t = s.trim();
  if (t === '') return { value: null };
  const m = t.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
  if (!m) return { error: `日付として解釈できません(YYYY/MM/DD): "${s}"` };
  return { value: `${m[1]}-${pad(m[2]!)}-${pad(m[3]!)}` };
}

function coerceDateTime(s: string): CoerceResult {
  const t = s.trim();
  if (t === '') return { value: null };
  const m = t.match(
    /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/,
  );
  if (!m) return { error: `日時として解釈できません(YYYY/MM/DD HH:mm): "${s}"` };
  const [, y, mo, d, h, mi, se] = m;
  return {
    value: `${y}-${pad(mo!)}-${pad(d!)}T${pad(h ?? '0')}:${pad(mi ?? '0')}:${pad(se ?? '0')}`,
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
