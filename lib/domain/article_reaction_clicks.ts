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

/** 日本時間での「昨日」(YYYY-MM-DD)。取込画面の日付の既定値(配信は前日で、翌朝にクリック履歴を取り込む運用。2026-09-25) */
export function jstYesterday(now: Date = new Date()): string {
  return jstDateOf(new Date(now.getTime() - 24 * 3600 * 1000).toISOString());
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
  /** 読者名前(CSV)。メールで当たらないときの氏名照合に使う(任意) */
  name?: string | null;
}

export interface MemberForMatch {
  id: string;
  name: string | null;
  email1: string | null;
  email2: string | null;
  email3: string | null;
}

export interface EmailMatchResult {
  /** 1 人に絞れた行 → 会員ID・会員氏名を入れる。by はその根拠(メール完全一致 / 氏名一致) */
  linked: Array<{ id: string; memberId: string; memberName: string | null; by: 'email' | 'name' }>;
  /** 同じメールの会員が複数いて絞れない行(変えない) */
  multiple: string[];
  /** 該当する会員がいない行(変えない) */
  none: string[];
  /** メールアドレスを持たない行(Salesforce 形式の取込分など。変えない) */
  noEmail: string[];
}

/**
 * 記事反応のメールアドレスを会員の email1〜3 と完全一致(小文字化)で照合する。
 * メールで当たらない行は、読者名前が会員氏名と一致(空白を除いて比較)する会員が 1 人だけなら紐付ける(2026-09-23。
 * 配信ツールに登録したメールが CRM の会員のメールと違う人のため)。同名が複数なら「複数候補」で止める。
 * 削除済みの会員は呼び出し側で除いて渡す。メールも氏名も無い行は noEmail。
 */
export function matchReactionsByEmail(
  reactions: ReactionForMatch[],
  members: MemberForMatch[],
): EmailMatchResult {
  const byEmail = new Map<string, MemberForMatch[]>();
  const byName = new Map<string, MemberForMatch[]>();
  for (const m of members) {
    for (const e of [m.email1, m.email2, m.email3]) {
      const key = (e ?? '').trim().toLowerCase();
      if (!key) continue;
      const list = byEmail.get(key) ?? [];
      if (!list.some((x) => x.id === m.id)) list.push(m);
      byEmail.set(key, list);
    }
    const n = normalizeName(m.name);
    if (n) {
      const list = byName.get(n) ?? [];
      if (!list.some((x) => x.id === m.id)) list.push(m);
      byName.set(n, list);
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
      result.linked.push({ id: r.id, memberId: m.id, memberName: m.name, by: 'email' });
      continue;
    }
    if (hits.length > 1) {
      result.multiple.push(r.id);
      continue;
    }
    const n = normalizeName(r.name);
    const nameHits = n ? (byName.get(n) ?? []) : [];
    if (nameHits.length === 1) {
      const m = nameHits[0] as MemberForMatch;
      result.linked.push({ id: r.id, memberId: m.id, memberName: m.name, by: 'name' });
    } else if (nameHits.length > 1) {
      result.multiple.push(r.id);
    } else {
      result.none.push(r.id);
    }
  }
  return result;
}

/** 既存の Salesforce 形式の行(メール列なし。詳細 = 記事名) */
export interface LegacyReactionRow {
  id: string;
  member_id: string | null;
  member_name: string | null;
  reacted_date: string | null;
}

/** 氏名の比較用: 空白(半角・全角)を除く */
export function normalizeName(name: string | null | undefined): string {
  return (name ?? '').replace(/[\s\u3000]/g, '');
}

export interface LegacyMatch {
  /** クリック行のメール(小文字) */
  email: string;
  /** 一致した既存行の ID */
  existingId: string;
  /** 一致の根拠 */
  by: 'email' | 'name';
}

/**
 * クリック履歴の行(1 人 1 件)を、既存の Salesforce 形式の行と突き合わせる(2026-09-23)。
 * 同じ記事名の既存行(呼び出し側で絞る)のうち、日付が同じで、
 *   会員のメール(email1〜3)がクリック行のメールと一致する(email)、または
 *   会員氏名が読者名前と一致する(空白を除いて比較。name)
 * ものを「同じ反応」とみなす。メール一致を優先し、候補が複数なら先頭(ID 順)を使う。
 * @param effectiveDate クリック行 → 取り込むときの日付(画面で指定した日付、無ければクリック日)
 * @param memberEmails 会員ID → メール(小文字)の一覧
 */
export function matchLegacyReactions(
  clicks: DedupedClick[],
  legacy: LegacyReactionRow[],
  memberEmails: Map<string, string[]>,
  effectiveDate: (row: DedupedClick) => string,
): LegacyMatch[] {
  const byEmail = new Map<string, LegacyReactionRow[]>();
  const byName = new Map<string, LegacyReactionRow[]>();
  const sorted = [...legacy].sort((a, b) => a.id.localeCompare(b.id));
  for (const l of sorted) {
    if (!l.reacted_date) continue;
    for (const e of l.member_id ? (memberEmails.get(l.member_id) ?? []) : []) {
      const key = `${l.reacted_date}|${e.toLowerCase()}`;
      byEmail.set(key, [...(byEmail.get(key) ?? []), l]);
    }
    const n = normalizeName(l.member_name);
    if (n) {
      const key = `${l.reacted_date}|${n}`;
      byName.set(key, [...(byName.get(key) ?? []), l]);
    }
  }
  const out: LegacyMatch[] = [];
  for (const c of clicks) {
    const date = effectiveDate(c);
    const e = byEmail.get(`${date}|${c.email}`)?.[0];
    if (e) {
      out.push({ email: c.email, existingId: e.id, by: 'email' });
      continue;
    }
    const n = normalizeName(c.name);
    const m = n ? byName.get(`${date}|${n}`)?.[0] : undefined;
    if (m) out.push({ email: c.email, existingId: m.id, by: 'name' });
  }
  return out;
}
