/**
 * 記事反応リスト: クリック履歴 CSV の取込と会員照合の純粋関数(CLAUDE.md §5.13b。migration 117)。
 *
 * - 配信ツールの「クリック履歴」CSV(列: クリック日時 / リンクNo / 読者No / 読者メールアドレス / 読者名前)を
 *   1 人(メールアドレス)1 件にまとめる(`dedupeClickRows`)。同じ人が複数リンク・複数回クリックしても 1 件。
 * - 会員照合はメールアドレスの完全一致(小文字化)のみ(`matchReactionsByEmail`)。あいまい一致はしない。
 * DB とのやり取りは lib/domain/import_article_reaction_clicks.ts / article_reaction_actions.ts が行う。
 */

/** CSV の列名(配信ツールの書き出しに合わせる) */
export const CLICK_CSV_COLUMNS = {
  clickedAt: 'クリック日時',
  email: '読者メールアドレス',
  name: '読者名前',
} as const;

export interface ClickRowInput {
  /** クリック日時(例 "2026-09-23 08:00:35"。日本時間) */
  clickedAt: string;
  email: string;
  name: string;
}

export interface DedupedClick {
  /** 小文字化したメールアドレス(突合キー) */
  email: string;
  /** 空でない最初の名前。無ければ null */
  name: string | null;
  /** いちばん早いクリック日時(UTC の ISO 文字列) */
  registeredAt: string;
  /** 登録日(日本時間の YYYY-MM-DD。一覧の並びに使う reacted_date) */
  registeredDate: string;
  /** まとめた元行の数 */
  clickCount: number;
}

export interface DedupeResult {
  rows: DedupedClick[];
  /** 行番号(1 始まり)とエラー内容 */
  errors: Array<{ row: number; message: string }>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * "2026-09-23 08:00:35" / "2026/9/23 8:00" などの日本時間を UTC の ISO 文字列にする。
 * 解釈できなければ null。
 */
export function parseJstDateTime(input: string): string | null {
  const m = input
    .trim()
    .match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const y = m[1] ?? '';
  const mo = m[2] ?? '';
  const d = m[3] ?? '';
  const h = m[4] ?? '0';
  const mi = m[5] ?? '0';
  const s = m[6] ?? '0';
  const pad = (v: string) => v.padStart(2, '0');
  const iso = `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}+09:00`;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  // 2026-02-30 のような存在しない日付は Date が繰り上げるので、戻して一致を確認する
  const back = new Date(t.getTime() + 9 * 3600 * 1000);
  if (back.getUTCMonth() + 1 !== Number(mo) || back.getUTCDate() !== Number(d)) return null;
  return t.toISOString();
}

/** UTC の ISO 文字列 → 日本時間の日付(YYYY-MM-DD) */
export function jstDateOf(iso: string): string {
  const t = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return t.toISOString().slice(0, 10);
}

/**
 * クリック履歴の行を 1 人 1 件にまとめる。
 * - メールアドレスは小文字化して突合。形式が不正・空の行はエラー(取り込まない)
 * - クリック日時を解釈できない行はエラー
 * - 登録日時はその人のいちばん早いクリック、名前は空でない最初の値
 * 出力の順序は最初に現れた順。
 */
export function dedupeClickRows(inputs: ClickRowInput[]): DedupeResult {
  const byEmail = new Map<string, DedupedClick>();
  const errors: DedupeResult['errors'] = [];
  inputs.forEach((r, i) => {
    const row = i + 1;
    const email = (r.email ?? '').trim().toLowerCase();
    if (email === '') {
      errors.push({ row, message: 'メールアドレスが空です' });
      return;
    }
    if (!EMAIL_RE.test(email)) {
      errors.push({ row, message: `メールアドレスの形式が不正です: ${email}` });
      return;
    }
    const at = parseJstDateTime(r.clickedAt ?? '');
    if (!at) {
      errors.push({ row, message: `クリック日時を解釈できません: ${r.clickedAt}` });
      return;
    }
    const name = (r.name ?? '').trim() || null;
    const cur = byEmail.get(email);
    if (!cur) {
      byEmail.set(email, {
        email,
        name,
        registeredAt: at,
        registeredDate: jstDateOf(at),
        clickCount: 1,
      });
      return;
    }
    cur.clickCount += 1;
    if (!cur.name && name) cur.name = name;
    if (at < cur.registeredAt) {
      cur.registeredAt = at;
      cur.registeredDate = jstDateOf(at);
    }
  });
  return { rows: [...byEmail.values()], errors };
}

export interface ReactionForMatch {
  id: string;
  email: string | null;
}

export interface MemberForMatch {
  id: string;
  name: string | null;
  email1: string | null;
  email2: string | null;
  email3: string | null;
}

export interface EmailMatchResult {
  /** 1 人に絞れた行 → 会員ID・会員氏名を入れる */
  linked: Array<{ id: string; memberId: string; memberName: string | null }>;
  /** 同じメールの会員が複数いて絞れない行(変えない) */
  multiple: string[];
  /** 該当する会員がいない行(変えない) */
  none: string[];
  /** メールアドレスを持たない行(Salesforce 形式の取込分など。変えない) */
  noEmail: string[];
}

/**
 * 記事反応のメールアドレスを会員の email1〜3 と完全一致(小文字化)で照合する。
 * 削除済みの会員は呼び出し側で除いて渡す。
 */
export function matchReactionsByEmail(
  reactions: ReactionForMatch[],
  members: MemberForMatch[],
): EmailMatchResult {
  const byEmail = new Map<string, MemberForMatch[]>();
  for (const m of members) {
    for (const e of [m.email1, m.email2, m.email3]) {
      const key = (e ?? '').trim().toLowerCase();
      if (!key) continue;
      const list = byEmail.get(key) ?? [];
      if (!list.some((x) => x.id === m.id)) list.push(m);
      byEmail.set(key, list);
    }
  }
  const result: EmailMatchResult = { linked: [], multiple: [], none: [], noEmail: [] };
  for (const r of reactions) {
    const key = (r.email ?? '').trim().toLowerCase();
    if (!key) {
      result.noEmail.push(r.id);
      continue;
    }
    const hits = byEmail.get(key) ?? [];
    if (hits.length === 1) {
      const m = hits[0] as MemberForMatch;
      result.linked.push({ id: r.id, memberId: m.id, memberName: m.name });
    } else if (hits.length > 1) {
      result.multiple.push(r.id);
    } else {
      result.none.push(r.id);
    }
  }
  return result;
}
