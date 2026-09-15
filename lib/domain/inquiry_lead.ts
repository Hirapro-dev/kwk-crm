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
