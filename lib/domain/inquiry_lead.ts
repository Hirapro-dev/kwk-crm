/**
 * 問合せ一覧のリード操作(CLAUDE.md §5.16 段階④)の純粋関数。
 * 会員の自動照合結果(inquiries.member_match)と会員IDの有無から、行に出す状態の文言を決める。
 * サーバー依存を持たない(クライアント部品からも import できる)。
 */

import type { MemberMatchStatus } from './mail_import_match';

/** inquiries.member_match の形(migration 88) */
export interface MemberMatch {
  status: MemberMatchStatus;
  points: number;
  candidates: string[];
  checked_at?: string;
}

export interface MatchLabel {
  text: string;
  tone: 'ok' | 'warn' | 'muted';
}

/** 行に出す照合状態の文言 */
export function memberMatchLabel(
  match: MemberMatch | null | undefined,
  memberId: string | null | undefined,
): MatchLabel {
  if (memberId) {
    return { text: match?.status === 'auto' ? '会員化済(自動)' : '会員化済', tone: 'ok' };
  }
  if (!match) return { text: '未照合', tone: 'muted' };
  switch (match.status) {
    case 'candidates':
      return { text: `候補あり(${match.candidates.length}件)`, tone: 'warn' };
    case 'none':
      return { text: '該当なし', tone: 'muted' };
    case 'manual':
      return { text: '確認済み(会員なし)', tone: 'muted' };
    default:
      return { text: '未照合', tone: 'muted' };
  }
}

const FIELD_ORDER: Array<[string, string]> = [
  ['name', '氏名'],
  ['phone', '電話'],
  ['email', 'メール'],
  ['address', '住所'],
];

/** 一致した項目(DB 関数 match_members_for_inquiry の matched)を表示用の文言にする */
export function matchedFieldsLabel(matched: readonly string[]): string {
  const set = new Set(matched);
  const parts = FIELD_ORDER.filter(([k]) => set.has(k)).map(([, label]) => label);
  return parts.length > 0 ? parts.join('・') : '一致なし';
}

/** 問合せの値のうち会員に反映する候補(§8.1「この会員に紐付け」。2026-09-17) */
export interface InquiryOverrideSource {
  name_kana: string | null | undefined;
  email: string | null | undefined;
  phone: string | null | undefined;
  postal_code: string | null | undefined;
  address: string | null | undefined;
  ad_id: string | null | undefined;
}

export interface MemberOverrideTarget {
  name_kana: string | null | undefined;
  email1: string | null | undefined;
  email2: string | null | undefined;
  email3: string | null | undefined;
  phone1: string | null | undefined;
  postal_code: string | null | undefined;
  address: string | null | undefined;
  ad_id: string | null | undefined;
  /** 会員の extra(電話番号2・3 を見る) */
  extra: Record<string, unknown> | null | undefined;
}

export interface InquiryOverrides {
  /** DB カラムへの初期値(会員側が空の項目だけ) */
  columns: Record<string, string>;
  /** extra(電話番号2・3)への初期値 */
  extra: Record<string, string>;
}

const nz = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const digits = (v: unknown): string => nz(v).replace(/[^\d]/g, '');

/**
 * 「この会員に紐付け」で会員の編集フォームに差し込む初期値を決める(純粋関数)。
 * - 会員側が空の項目だけ埋める。既にある値は上書きしない(利用者がフォームで直せる)
 * - メールは小文字で比較し、既存(email1〜3)に無ければ空いている枠に入れる
 * - 電話は数字だけで比較し、phone1・電話番号2・3 に無ければ空いている枠に入れる(電話番号2・3 は extra)
 */
export function inquiryOverridesForMember(
  inquiry: InquiryOverrideSource,
  member: MemberOverrideTarget,
): InquiryOverrides {
  const columns: Record<string, string> = {};
  const extra: Record<string, string> = {};

  for (const key of ['name_kana', 'postal_code', 'address', 'ad_id'] as const) {
    const v = nz(inquiry[key]);
    if (v && !nz(member[key])) columns[key] = v;
  }

  const email = nz(inquiry.email).toLowerCase();
  if (email) {
    const slots = ['email1', 'email2', 'email3'] as const;
    const existing = slots.map((k) => nz(member[k]).toLowerCase());
    if (!existing.includes(email)) {
      const free = slots.find((k) => !nz(member[k]));
      if (free) columns[free] = email;
    }
  }

  const phone = digits(inquiry.phone);
  if (phone) {
    const ex = member.extra ?? {};
    const existing = [digits(member.phone1), digits(ex.電話番号2), digits(ex.電話番号3)];
    if (!existing.includes(phone)) {
      if (!nz(member.phone1)) columns.phone1 = phone;
      else if (!nz(ex.電話番号2)) extra.電話番号2 = phone;
      else if (!nz(ex.電話番号3)) extra.電話番号3 = phone;
    }
  }
  return { columns, extra };
}
