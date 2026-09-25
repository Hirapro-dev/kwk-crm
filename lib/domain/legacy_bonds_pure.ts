/**
 * 旧社債管理(legacy_bonds)取込の純粋関数(CLAUDE.md §5.13c。migration 118)。
 * CSV の 1 行(ヘッダー名 → 文字列)を DB の行に変換し、会員 / 申込 / 案件のリレーションを
 * 「実在するものだけ紐付け、原文は保持」の規則で決める。DB とのやり取りは import_legacy_bonds.ts。
 */

import { coerceValue, isCoerceErr } from '@/lib/import/coerce';
import type { ImportField } from '@/lib/import/schema';

export type LegacyBondRecord = Record<string, string | number | boolean | null>;

export interface LegacyBondLinkContext {
  /** 実在する会員ID(K-) */
  validMemberIds: Set<string>;
  /** 実在する申込ID(M-) */
  validApplicationIds: Set<string>;
  /** 案件名(トリム済み)→ 案件ID(T-) */
  projectIdByName: Map<string, string>;
}

/**
 * 1 行を DB レコードへ変換する。
 * - 各列は取込定義の型で変換(数値・日付の形式が不正ならエラー)
 * - id(旧社債管理ID)は必須
 * - 会員ID / 申込ID は実在するものだけ FK に入れる(申込の原文は application_no に残す)
 * - 案件は名前で案件マスタを引き、あれば project_id、原文は project_name に残す
 */
export function convertLegacyBondRow(
  raw: Record<string, string>,
  fields: readonly ImportField[],
  ctx: LegacyBondLinkContext,
): { record?: LegacyBondRecord; error?: string } {
  const rec: LegacyBondRecord = {};
  for (const f of fields) {
    const res = coerceValue(f.type, (raw[f.label] ?? '').toString());
    if (isCoerceErr(res)) return { error: `${f.label}: ${res.error}` };
    rec[f.field] = res.value;
  }
  const id = (rec.id ?? '').toString().trim();
  if (id === '') return { error: '旧社債管理ID が空です' };
  rec.id = id;

  const mid = (rec.member_id ?? '').toString().trim();
  rec.member_id = mid !== '' && ctx.validMemberIds.has(mid) ? mid : null;

  const appNo = (rec.application_no ?? '').toString().trim();
  rec.application_no = appNo === '' ? null : appNo;
  rec.application_id = appNo !== '' && ctx.validApplicationIds.has(appNo) ? appNo : null;

  const pname = (rec.project_name ?? '').toString().trim();
  rec.project_name = pname === '' ? null : pname;
  rec.project_id = pname !== '' ? (ctx.projectIdByName.get(pname) ?? null) : null;

  // 前回継続年数は整数列
  if (typeof rec.prev_years === 'number') rec.prev_years = Math.trunc(rec.prev_years);
  return { record: rec };
}
