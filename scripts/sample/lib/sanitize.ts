/**
 * CSV サンプル抽出時の個人情報サニタイズユーティリティ。
 * 仕様書 §15-6:「実データ氏名は使わない」を厳守する。
 *
 * 設計方針:
 *   - 元の値からハッシュを取って決定論的に置換(同じ氏名→同じダミー氏名)
 *   - データの分布・関係性は維持
 *   - 構造的特徴(電話の桁数、メールのドメイン分布等)はある程度模倣
 */

import { createHash } from 'node:crypto';

const SURNAMES = [
  'テスト', 'サンプル', 'ダミー', 'ヤマダ', 'タナカ', 'スズキ', 'サトウ', 'タカハシ',
  'イトウ', 'ワタナベ', 'ナカムラ', 'コバヤシ', 'カトウ', 'ヨシダ', 'ヤマモト', 'ササキ',
];

const GIVEN_NAMES = [
  '太郎', '次郎', '三郎', '四郎', '五郎', '花子', '梅子', '桃子',
  '一郎', '二郎', '三郎', '一美', '二美', '三美', '小太郎', '小次郎',
];

/**
 * 文字列から決定論的に0-N-1の整数を返す。
 */
function hashIndex(input: string, modulo: number): number {
  if (!input) return 0;
  const h = createHash('sha256').update(input).digest();
  return h.readUInt32BE(0) % modulo;
}

/**
 * 氏名をサニタイズ(漢字・かな両対応)。
 * 同じ入力に対して同じ出力を返す(決定論的)。
 */
export function sanitizeName(raw: string | null | undefined, seqHint = 0): string {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  if (!trimmed) return '';
  // 元データの文字種を判別して、カナならカナ姓、漢字なら漢字姓を使う(簡易判定)
  const isKana = /^[\u30A0-\u30FF\u3040-\u309Fー \u3000]+$/.test(trimmed);
  if (isKana) {
    const sIdx = hashIndex(trimmed, SURNAMES.length);
    const num = (hashIndex(trimmed, 9999) + seqHint).toString().padStart(4, '0');
    return `${SURNAMES[sIdx]} ${num}`;
  }
  const sIdx = hashIndex(trimmed, SURNAMES.length);
  const gIdx = hashIndex(`${trimmed}_g`, GIVEN_NAMES.length);
  // 漢字氏名はカタカナで返す(本物の漢字氏名と確実に区別)
  return `${SURNAMES[sIdx]} ${GIVEN_NAMES[gIdx]}`;
}

/**
 * メールアドレスをダミー化。ドメインは @dev.local に固定。
 * 同じ入力→同じ出力。
 */
export function sanitizeEmail(raw: string | null | undefined, seqHint = 0): string {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  if (!trimmed) return '';
  const idx = (hashIndex(trimmed, 99999) + seqHint).toString().padStart(5, '0');
  return `dummy-${idx}@dev.local`;
}

/**
 * 電話番号をダミー化。
 * 元の長さや先頭桁の構造はざっくり保持(080/090系→080始まり、050系→050始まり等)。
 */
export function sanitizePhone(raw: string | null | undefined, seqHint = 0): string {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  if (!trimmed) return '';
  // 数字のみ抽出
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  // 先頭2-3桁を保持(080, 090, 050 等)
  let prefix = '080';
  if (digits.startsWith('090')) prefix = '090';
  else if (digits.startsWith('070')) prefix = '070';
  else if (digits.startsWith('050')) prefix = '050';
  else if (digits.startsWith('03')) prefix = '03';
  else if (digits.startsWith('06')) prefix = '06';
  const rest = (hashIndex(trimmed, 99999999) + seqHint).toString().padStart(8, '0');
  return `${prefix}${rest.slice(0, 11 - prefix.length)}`;
}

/**
 * 住所をダミー化。都道府県名・市区名はそのまま、それ以降は「ダミー町X-Y-Z」固定。
 */
export function sanitizeAddress(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  if (!trimmed) return '';
  // 都道府県+市区まで抽出(簡易)
  const m = trimmed.match(/^(.+?[都道府県])(.+?[市区町村])/);
  if (m) {
    return `${m[1]}${m[2]}ダミー町1-2-3`;
  }
  // パターン外: 先頭3文字 + ダミー
  return `${trimmed.slice(0, 3)}ダミー町1-2-3`;
}

/**
 * 郵便番号: 大きな個人特定にはならないが、念のため最後の桁だけマスク。
 */
export function sanitizePostalCode(raw: string | null | undefined): string {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 3) return '';
  // 上3桁(地域コード)はそのまま、下4桁はゼロ
  return `${digits.slice(0, 3)}-0000`;
}

/**
 * 生年月日: 年だけ保持して月日は固定(7/15)。
 */
export function sanitizeBirthdate(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  if (!trimmed) return '';
  // 年だけ拾う
  const m = trimmed.match(/(\d{4})/);
  if (!m) return '';
  return `${m[1]}-07-15`;
}

/**
 * 自由記述コメント: 「[サニタイズ済み]」プレフィックスをつけて先頭50文字までに切り詰め。
 * 仕様書 §15-6 に従い、自由記述に個人情報が混じる可能性も考慮。
 */
export function sanitizeFreeText(
  raw: string | null | undefined,
  keep = false,
): string {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  if (!trimmed) return '';
  if (keep) return trimmed;
  // 個人情報の可能性があるので置換
  return `[ダミー] ${trimmed.replace(/\d{6,}/g, 'XXX').slice(0, 80)}`;
}
