/**
 * メール取込ルール(CLAUDE.md §5.16)の純粋関数。
 *
 * 取込候補のフォーム通知メール(本文が「ラベル: 値」の行で構成される定型メール)から、
 * 問合せ(inquiries)の項目を決定論的に切り出す。AI 判断は使わない(§0.1 R6)。
 * 画面のプレビューとサーバーの実行が同じ関数を使うため、サーバー依存を持たない
 * (クライアント部品からも import できる)。
 */

/** フォーム名の取り方 */
export const FORM_NAME_SOURCES = [
  'subject',
  'subject_without_name',
  'body_line',
  'body_label',
  'fixed',
] as const;
export type FormNameSource = (typeof FORM_NAME_SOURCES)[number];

export const FORM_NAME_SOURCE_LABELS: Record<FormNameSource, string> = {
  subject: '件名をそのまま',
  subject_without_name: '件名から「○○ 様」を除く',
  body_line: '本文のN行目(空行は数えない)',
  body_label: '本文のラベルの値',
  fixed: '固定の文字列',
};

/** 本文のラベルを割り当てられる問合せの項目(extra:<キー> はこれとは別に許可) */
export const FIELD_COLUMNS = [
  'name',
  'name_kana',
  'email',
  'phone',
  'postal_code',
  'address',
  'ad_id',
  'registered_at',
] as const;
export type FieldColumn = (typeof FIELD_COLUMNS)[number];

export const FIELD_COLUMN_LABELS: Record<FieldColumn, string> = {
  name: '氏名',
  name_kana: '氏名(カナ)',
  email: 'メール',
  phone: '電話',
  postal_code: '郵便番号',
  address: '住所',
  ad_id: '広告ID',
  registered_at: '登録日時',
};

export interface MailImportRule {
  id: number;
  name: string;
  is_active: boolean;
  sort_order: number;
  /** null = 受信箱で絞らない */
  mail_box_id: number | null;
  /** null = 差出人で絞らない。小文字 */
  from_address: string | null;
  /** null = 件名で絞らない。空白区切りのキーワード(すべて含むときに一致。subjectKeywords) */
  subject_contains: string | null;
  form_name_source: FormNameSource;
  form_name_param: string | null;
  /** 本文のラベル → 問合せの項目(FieldColumn または "extra:<キー>") */
  field_map: Record<string, string>;
}

export interface ParsedMailBody {
  /** 空行を除いた本文の行(前後の空白は除く) */
  lines: string[];
  /** 「ラベル: 値」の辞書(同じラベルは最初の値) */
  labels: Record<string, string>;
}

/** HTML 本文を素朴にテキスト化する(ブロック要素の境界を改行に、タグを除去、実体参照を戻す) */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*\/?\s*(br|p|div|tr|li|h[1-6]|table|ul|ol)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

const LABEL_LINE = /^([^:：]{1,40}?)\s*[:：]\s*(.+)$/;

/** 本文(テキスト。無ければ HTML をテキスト化)を行とラベルの辞書にする */
export function parseMailBody(
  textBody: string | null | undefined,
  htmlBody: string | null | undefined,
): ParsedMailBody {
  const text = textBody?.trim() ? textBody : htmlBody ? htmlToText(htmlBody) : '';
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  const labels: Record<string, string> = {};
  for (const line of lines) {
    const m = line.match(LABEL_LINE);
    if (!m) continue;
    const label = (m[1] ?? '').trim();
    const value = (m[2] ?? '').trim();
    if (!label || !value || /https?/i.test(label)) continue;
    if (!(label in labels)) labels[label] = value;
  }
  return { lines, labels };
}

const LATIN_WORD = /^[A-Za-z.'-]+$/;

/**
 * 件名から「○○ 様」の部分を除く(フォーム名として使うため)。
 *   "…本人確認完了 オオシマ 様（キオクシア）" → "…本人確認完了（キオクシア）"
 *   "…本人確認完了 Shoji Murakami 様（ゴールド）" → "…本人確認完了（ゴールド）"
 * 「様」の直前の1語を氏名とみなす。直前が英字だけの語なら(ローマ字表記)連続する英字の語をまとめて除く。
 */
export function subjectWithoutName(subject: string): string {
  const tokens = subject.trim().split(/\s+/);
  const i = tokens.findIndex((t) => t.startsWith('様'));
  if (i <= 0) return subject.trim();
  let start = i - 1;
  if (LATIN_WORD.test(tokens[start] ?? '')) {
    while (start - 1 > 0 && LATIN_WORD.test(tokens[start - 1] ?? '')) start--;
  }
  const rest = (tokens[i] ?? '').slice(1); // 「様」の後ろ(例: "（キオクシア）")
  const kept = [...tokens.slice(0, start), ...(rest ? [rest] : []), ...tokens.slice(i + 1)];
  let out = '';
  for (const t of kept) {
    if (out === '' || /^[（(]/.test(t)) out += t;
    else out += ` ${t}`;
  }
  return out.trim();
}

/** ルールの設定に従ってフォーム名を決める。取れなければ null(勝手に別名を付けない) */
export function resolveFormName(
  rule: Pick<MailImportRule, 'form_name_source' | 'form_name_param'>,
  subject: string,
  parsed: ParsedMailBody,
): string | null {
  const param = (rule.form_name_param ?? '').trim();
  switch (rule.form_name_source) {
    case 'subject':
      return subject.trim() || null;
    case 'subject_without_name':
      return subjectWithoutName(subject) || null;
    case 'body_line': {
      const n = Number.parseInt(param, 10);
      if (!Number.isInteger(n) || n < 1) return null;
      return parsed.lines[n - 1] ?? null;
    }
    case 'body_label':
      return param ? (parsed.labels[param] ?? null) : null;
    case 'fixed':
      return param || null;
    default:
      return null;
  }
}

const DATE_TIME =
  /^(\d{4})[/\-年](\d{1,2})[/\-月](\d{1,2})日?(?:\s+(\d{1,2})[:：](\d{2})(?:[:：](\d{2}))?)?$/;

/**
 * 「2026/9/15 9:42:03」「2026-09-15 09:42」「2026/09/15」を日本時間として ISO 文字列にする。
 * 解釈できなければ null。
 */
export function parseJstDateTime(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  const m = s.match(DATE_TIME);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4] ?? 0);
  const mi = Number(m[5] ?? 0);
  const se = Number(m[6] ?? 0);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return null;
  const utcMs = Date.UTC(y, mo - 1, d, h, mi, se) - 9 * 60 * 60 * 1000;
  const date = new Date(utcMs);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/** 電話番号は数字だけにする(先頭の 0 は残す) */
export function normalizePhone(raw: string): string {
  return raw.replace(/[^\d]/g, '');
}

export interface AppliedRule {
  formName: string | null;
  fields: Partial<Record<Exclude<FieldColumn, 'registered_at'>, string>>;
  extra: Record<string, string>;
  registeredAt: string | null;
  errors: string[];
}

/** ルールをメール1通に適用し、問合せに入れる値を組み立てる(書込みはしない) */
export function applyRule(
  rule: Pick<MailImportRule, 'form_name_source' | 'form_name_param' | 'field_map'>,
  input: { subject: string; textBody: string | null; htmlBody: string | null },
): AppliedRule {
  const parsed = parseMailBody(input.textBody, input.htmlBody);
  const errors: string[] = [];
  const formName = resolveFormName(rule, input.subject, parsed);
  if (!formName) errors.push('フォーム名を取得できません(取り方の設定を見直してください)');

  const fields: AppliedRule['fields'] = {};
  const extra: Record<string, string> = {};
  let registeredAt: string | null = null;
  for (const [label, target] of Object.entries(normalizeFieldMap(rule.field_map))) {
    const value = parsed.labels[label];
    if (value === undefined) continue;
    if (target.startsWith('extra:')) {
      extra[target.slice('extra:'.length)] = value;
    } else if (target === 'registered_at') {
      const iso = parseJstDateTime(value);
      if (iso) registeredAt = iso;
      else errors.push(`登録日時を解釈できません: ${value}`);
    } else if (target === 'phone') {
      const digits = normalizePhone(value);
      if (digits) fields.phone = digits;
    } else if (target === 'email') {
      fields.email = value.toLowerCase();
    } else {
      fields[target as Exclude<FieldColumn, 'registered_at' | 'phone' | 'email'>] = value;
    }
  }
  return { formName, fields, extra, registeredAt, errors };
}

/** field_map を検証し、許可された項目だけを残す(ホワイトリスト。§9.8 と同じ考え方) */
export function normalizeFieldMap(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== 'object') return out;
  for (const [rawLabel, rawTarget] of Object.entries(input as Record<string, unknown>)) {
    const label = rawLabel.trim().slice(0, 100);
    if (!label || typeof rawTarget !== 'string') continue;
    const target = rawTarget.trim();
    if ((FIELD_COLUMNS as readonly string[]).includes(target)) {
      out[label] = target;
      continue;
    }
    if (target.startsWith('extra:')) {
      const key = target.slice('extra:'.length).trim().slice(0, 100);
      if (key) out[label] = `extra:${key}`;
    }
  }
  return out;
}

export interface RuleMatchInput {
  mailBoxId: number | null;
  fromAddress: string;
  subject: string | null;
}

/**
 * 件名の条件(subject_contains)をキーワードに分ける。半角/全角の空白区切り。
 * 実際の件名は「【Google広告経由】【…請求】本人確認完了 ○○ 様（社名）」のように語順や差し込みが
 * メールごとに違うため、丸ごとの部分一致ではなくキーワードの AND で判定する(2026-09-15)。
 */
export function subjectKeywords(text: string | null | undefined): string[] {
  return (text ?? '')
    .split(/[\s\u3000]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/** ルールの一致条件(受信箱・差出人・件名キーワード)をすべて満たすか。無効なルールは一致しない */
export function ruleMatches(rule: MailImportRule, msg: RuleMatchInput): boolean {
  if (!rule.is_active) return false;
  if (rule.mail_box_id !== null && rule.mail_box_id !== msg.mailBoxId) return false;
  if (
    rule.from_address &&
    rule.from_address.toLowerCase() !== msg.fromAddress.trim().toLowerCase()
  ) {
    return false;
  }
  const keywords = subjectKeywords(rule.subject_contains);
  if (keywords.length > 0) {
    const subject = msg.subject ?? '';
    if (!keywords.every((k) => subject.includes(k))) return false;
  }
  return true;
}

/** 判定順(sort_order → id)で最初に一致するルール。無ければ null */
export function findMatchingRule(
  rules: readonly MailImportRule[],
  msg: RuleMatchInput,
): MailImportRule | null {
  const sorted = [...rules].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  return sorted.find((r) => ruleMatches(r, msg)) ?? null;
}
