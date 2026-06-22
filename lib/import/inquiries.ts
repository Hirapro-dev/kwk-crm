/**
 * 問合せ(inquiries)専用の取込変換ロジック (CLAUDE.md §5.3 / §6)
 *
 * 既存の移行スクリプト scripts/import/03_inquiries.ts と同じマッピングを「非破壊」で再現:
 *   - 共通11列 → inquiries の通常カラム
 *   - それ以外の列 → extra(JSONB) (フォーム固有項目)
 *   - 「#######」(7文字以上の # 連続) は null 扱い (仕様書 §6.3)
 *   - フォーム名 → form_id は呼び出し側(action)が forms テーブルを名前解決して渡す
 *
 * 純粋関数。DB アクセスは行わない(forms/members 解決は action 側)。
 */

import { coerceValue, isCoerceErr } from './coerce';

/** inquiries の通常カラムに入れる共通キー。これ以外は extra 行き。 */
export const INQUIRY_COMMON_KEYS = new Set<string>([
  '問合せID',
  '会員ID',
  'フォーム名',
  '広告ID',
  '氏名',
  '氏名かな',
  '郵便番号',
  '住所',
  'メールアドレス',
  '電話番号',
  '登録日時',
]);

const HASH_PLACEHOLDER = /^#{7,}$/;

/** ###...# 埋め文字は null、空白trim、空文字は null */
export function cleanInquiryValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '') return null;
  if (HASH_PLACEHOLDER.test(s)) return null;
  return s;
}

/** 共通キー以外を extra に格納(クリーニング後、非空のみ) */
export function buildInquiryExtra(
  raw: Record<string, string>,
): Record<string, string> {
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (INQUIRY_COMMON_KEYS.has(k)) continue;
    const cleaned = cleanInquiryValue(v);
    if (cleaned !== null) extra[k] = cleaned;
  }
  return extra;
}

export interface InquiryRecord {
  id: string;
  form_id: number | null;
  member_id: string | null;
  name: string | null;
  name_kana: string | null;
  email: string | null;
  phone: string | null;
  postal_code: string | null;
  address: string | null;
  ad_id: string | null;
  extra: Record<string, string>;
  registered_at: string;
}

export interface ConvertOptions {
  /** フォーム名 → form_id 解決マップ(action が forms から構築) */
  formNameToId: Map<string, number>;
  /** 既存 members.id 集合(FK安全のため、無いものは member_id=null) */
  validMemberIds: Set<string>;
}

export interface ConvertOutcome {
  record?: InquiryRecord;
  /** フォーム名(form_id 未解決時の新規作成用に返す) */
  formName?: string | null;
  error?: string;
}

/**
 * 1行を InquiryRecord に変換。問合せID/登録日時の不正はエラー(取込対象外)。
 * form_id は formNameToId に無ければ null(commit 前に forms を補完して再解決する想定)。
 */
export function convertInquiryRow(
  raw: Record<string, string>,
  rowNum: number,
  opts: ConvertOptions,
): ConvertOutcome {
  const id = cleanInquiryValue(raw['問合せID']);
  if (!id) return { error: `${rowNum}行目: 問合せID が空です` };
  if (!/^TA-\d{3,}$/.test(id)) {
    return { error: `${rowNum}行目: 問合せID 形式が不正です ("${id}")` };
  }

  // 登録日時(NOT NULL カラム)
  const regRaw = raw['登録日時'] ?? '';
  const regRes = coerceValue('datetime', regRaw);
  if (isCoerceErr(regRes)) {
    return { error: `${rowNum}行目: 登録日時 ${regRes.error}` };
  }
  if (regRes.value === null) {
    return { error: `${rowNum}行目: 登録日時 が必要です` };
  }

  const formName = cleanInquiryValue(raw['フォーム名']);
  const formId =
    formName && opts.formNameToId.has(formName)
      ? (opts.formNameToId.get(formName) as number)
      : null;

  // member_id は既存のもののみ採用
  const rawMember = cleanInquiryValue(raw['会員ID']);
  const memberId =
    rawMember && opts.validMemberIds.has(rawMember) ? rawMember : null;

  return {
    formName,
    record: {
      id,
      form_id: formId,
      member_id: memberId,
      name: cleanInquiryValue(raw['氏名']),
      name_kana: cleanInquiryValue(raw['氏名かな']),
      email: cleanInquiryValue(raw['メールアドレス']),
      phone: cleanInquiryValue(raw['電話番号']),
      postal_code: cleanInquiryValue(raw['郵便番号']),
      address: cleanInquiryValue(raw['住所']),
      ad_id: cleanInquiryValue(raw['広告ID']),
      extra: buildInquiryExtra(raw),
      registered_at: String(regRes.value),
    },
  };
}
