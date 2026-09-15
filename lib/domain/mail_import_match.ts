/**
 * メール取込の会員自動照合(CLAUDE.md §5.16)の純粋関数。
 *
 * 氏名・電話・メール・住所の4点を正規化して既存会員と比べ、3点以上一致で自動紐付け、
 * 1〜2点は候補、0点は該当なし。あいまい一致(部分一致)はしない。
 * 比較そのものは DB 側の関数 match_members_for_inquiry()(migration 88)が行い、
 * ここでは入力の正規化(DB 側と同じ規則)と、返ってきた点数からの判定を担当する。
 * サーバー依存を持たない。
 */

export interface MatchInput {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
}

export interface NormalizedMatchInput {
  name: string;
  phone: string;
  email: string;
  address: string;
}

/**
 * DB 側(match_members_for_inquiry)と同じ正規化:
 *   氏名・住所 = NFKC(全角半角統一)→ 空白除去 → 小文字 / 電話 = 数字のみ → 先頭の 0 を除く /
 *   メール = 前後空白除去 → 小文字。未指定は空文字(比較に使わない)。
 */
export function normalizeMatchInput(input: MatchInput): NormalizedMatchInput {
  const nfkc = (s: string | null | undefined) => (s ?? '').normalize('NFKC');
  return {
    name: nfkc(input.name).replace(/\s+/g, '').toLowerCase(),
    phone: (input.phone ?? '').replace(/\D/g, '').replace(/^0+/, ''),
    email: (input.email ?? '').trim().toLowerCase(),
    address: nfkc(input.address).replace(/\s+/g, '').toLowerCase(),
  };
}

export type MemberMatchStatus = 'auto' | 'candidates' | 'none' | 'manual';

export interface MemberMatchDecision {
  status: Exclude<MemberMatchStatus, 'manual'>;
  /** 自動紐付けする会員(auto のときだけ) */
  memberId: string | null;
  /** 最も多く一致した点数 */
  points: number;
  /** 候補の会員ID(点数の多い順。auto のときは1件) */
  candidates: string[];
}

/** 自動紐付けに必要な一致点数(4点中) */
export const AUTO_MATCH_MIN_POINTS = 3;
/** 候補として保持する最大件数 */
export const MAX_CANDIDATES = 5;

/**
 * DB の照合結果(会員IDと一致点数)から紐付けを決める。
 *   - 3点以上の会員がちょうど1人 → auto(その会員に紐付け)
 *   - 3点以上が複数 → candidates(自動では紐付けない。どちらか決められないため)
 *   - 1〜2点だけ → candidates(点数の多い順に最大5件)
 *   - 一致なし → none
 */
export function decideMemberMatch(
  rows: ReadonlyArray<{ member_id: string; points: number }>,
  minPoints = AUTO_MATCH_MIN_POINTS,
): MemberMatchDecision {
  const sorted = [...rows]
    .filter((r) => r.points > 0)
    .sort((a, b) => b.points - a.points || a.member_id.localeCompare(b.member_id));
  if (sorted.length === 0) return { status: 'none', memberId: null, points: 0, candidates: [] };
  const top = sorted[0] as { member_id: string; points: number };
  const winners = sorted.filter((r) => r.points >= minPoints);
  if (winners.length === 1) {
    return {
      status: 'auto',
      memberId: top.member_id,
      points: top.points,
      candidates: [top.member_id],
    };
  }
  const pool = winners.length > 1 ? winners : sorted;
  return {
    status: 'candidates',
    memberId: null,
    points: top.points,
    candidates: pool.slice(0, MAX_CANDIDATES).map((r) => r.member_id),
  };
}

/** ISO 日時を日本時間の日付(YYYY-MM-DD)にする(重複防止の「同じ登録日」判定用) */
export function jstDateKey(iso: string): string {
  const t = new Date(iso).getTime() + 9 * 60 * 60 * 1000;
  return new Date(t).toISOString().slice(0, 10);
}
