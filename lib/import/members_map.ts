/**
 * 会員(members)専用の取込変換ロジック (CLAUDE.md §5.4 / §6)
 *
 * 既存の移行スクリプト scripts/import/02_members.ts と同じ「実CSVヘッダー→カラム」対応を再現:
 *   - 会員氏名→name(必須/NOT NULL) 等の日本語ヘッダーをマッピング
 *   - 電話番号1 末尾の「架電NG」を do_not_call に分離(仕様書 §6.3)
 *   - 永久担当 は users 名前解決(呼び出し側がマップを渡す)。owner_name_raw は原文保持
 *   - 日付/金額は coerce で解釈(失敗時は null = 寛容)
 *
 * 純粋関数。DB アクセスは行わない(owner 解決マップは action 側で構築)。
 */

import { coerceValue, isCoerceErr } from './coerce';
import type { ImportFieldType } from './schema';

/** 実CSVヘッダー → DBカラム の直接対応(name/id/電話/担当/affiliate は個別処理) */
const DIRECT_FIELDS: Array<{ header: string; field: string; type: ImportFieldType }> = [
  { header: '会員かな', field: 'name_kana', type: 'text' },
  { header: '実質名義人', field: 'real_name', type: 'text' },
  { header: 'Eメール1', field: 'email1', type: 'text' },
  { header: 'Eメール2', field: 'email2', type: 'text' },
  { header: 'Eメール3', field: 'email3', type: 'text' },
  { header: '顧客種別', field: 'customer_type', type: 'text' },
  { header: '初回接触日', field: 'first_contact_date', type: 'date' },
  { header: '登録日', field: 'registered_at', type: 'datetime' },
  { header: 'メルマガ登録日時', field: 'mailmag_registered_at', type: 'datetime' },
  { header: '広告ID', field: 'ad_id', type: 'text' },
  { header: '広告媒体名', field: 'ad_medium', type: 'text' },
  { header: '個人情報取得ポイント', field: 'info_acquired_points', type: 'text' },
  { header: '顧客情報取得日', field: 'info_acquired_date', type: 'date' },
  { header: '性別', field: 'gender', type: 'text' },
  { header: '生年月日', field: 'birthdate', type: 'date' },
  { header: '紹介者氏名', field: 'referrer_name', type: 'text' },
  { header: 'アフィリ名', field: 'affiliate_name', type: 'text' },
  { header: '総合計額', field: 'total_amount', type: 'number' },
  { header: '総合計実入金額', field: 'total_paid_amount', type: 'number' },
  { header: '総利用額合計', field: 'total_used_amount', type: 'number' },
];

/** 標準カラムとして消費するヘッダー(これら以外は extra に格納) */
const CONSUMED_HEADERS = new Set<string>([
  '会員ID',
  '会員氏名',
  '電話番号1',
  '永久担当',
  '住所(フル)',
  '住所(フル）',
  'ｱﾌｨﾘID',
  'アフィリID',
  ...DIRECT_FIELDS.map((f) => f.header),
]);

/** テンプレCSVの共通ヘッダー(ダウンロード用) */
export const MEMBER_TEMPLATE_HEADERS = [
  '会員ID',
  '会員氏名',
  '会員かな',
  '永久担当',
  'Eメール1',
  '電話番号1',
  '住所(フル)',
  '顧客種別',
  '性別',
  '生年月日',
  '初回接触日',
  '登録日',
  '総合計額',
  '総合計実入金額',
  '総利用額合計',
];

function nz(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** 寛容な変換: 失敗時は null(行をエラーにしない) */
function lenient(type: ImportFieldType, raw: unknown): string | number | boolean | null {
  const r = coerceValue(type, raw == null ? '' : String(raw));
  return isCoerceErr(r) ? null : r.value;
}

/**
 * 電話番号末尾の「架電NG」を分離。
 * 「08034396967架電NG」「08034396967(架電NG)」→ { phone: "08034396967", doNotCall: true }
 */
export function parsePhone(raw: string | null): { phone: string | null; doNotCall: boolean } {
  const t = nz(raw);
  if (!t) return { phone: null, doNotCall: false };
  if (/架電NG/.test(t)) {
    const cleaned = t.replace(/[（(]?架電NG[）)]?/g, '').trim();
    return { phone: cleaned || null, doNotCall: true };
  }
  return { phone: t, doNotCall: false };
}

export interface OwnerMaps {
  /** full_name 完全一致 → users.id */
  byFullName: Map<string, string>;
  /** 姓(先頭トークン) → users.id (フォールバック) */
  byLastName: Map<string, string>;
}

export interface MemberRecord {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface MemberConvertOutcome {
  record?: MemberRecord;
  error?: string;
}

/**
 * 1行を members の upsert レコードに変換。
 * - 会員ID 空 → エラー / 会員氏名 空 → エラー(NOT NULL 保護)
 * - CSV に存在する列のみ設定(無い列は既存値を保持)
 */
export function convertMemberRow(
  raw: Record<string, string>,
  rowNum: number,
  ownerMaps: OwnerMaps,
): MemberConvertOutcome {
  const id = nz(raw['会員ID']);
  if (!id) return { error: `${rowNum}行目: 会員ID が空です` };

  const name = nz(raw['会員氏名']);
  if (!name) return { error: `${rowNum}行目: 会員氏名 が空です(必須)` };

  const data: MemberRecord = { id, name };

  const headers = new Set(Object.keys(raw));

  // 直接マッピング(CSV に列がある場合のみ)
  for (const m of DIRECT_FIELDS) {
    if (!headers.has(m.header)) continue;
    data[m.field] = lenient(m.type, raw[m.header]);
  }

  // 住所(フル) は全角/半角カッコの2表記に対応
  const addr = nz(raw['住所(フル)']) ?? nz(raw['住所(フル）']);
  if (headers.has('住所(フル)') || headers.has('住所(フル）')) data.address = addr;

  // アフィリID(半角カナ表記ゆれ)
  if (headers.has('ｱﾌｨﾘID') || headers.has('アフィリID')) {
    data.affiliate_id = nz(raw['ｱﾌｨﾘID']) ?? nz(raw['アフィリID']);
  }

  // 電話番号1 → phone1 + do_not_call(架電NG分離)
  if (headers.has('電話番号1')) {
    const { phone, doNotCall } = parsePhone(raw['電話番号1'] ?? null);
    data.phone1 = phone;
    data.do_not_call = doNotCall;
  }

  // 永久担当 → owner_name_raw(原文) + owner_id(名前解決)
  if (headers.has('永久担当')) {
    const ownerRaw = nz(raw['永久担当']);
    data.owner_name_raw = ownerRaw;
    let ownerId: string | null = null;
    if (ownerRaw && ownerRaw !== 'Free') {
      ownerId = ownerMaps.byFullName.get(ownerRaw) ?? null;
      if (!ownerId) {
        const last = ownerRaw.split(/[\s　]+/)[0];
        if (last) ownerId = ownerMaps.byLastName.get(last) ?? null;
      }
    }
    data.owner_id = ownerId;
  }

  // 標準カラムに無い列はすべて extra(JSONB) に保存(案件別利用額・任意フラグ等)
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (CONSUMED_HEADERS.has(k)) continue;
    const cleaned = nz(v);
    if (cleaned === null) continue;
    if (/^#{7,}$/.test(cleaned)) continue; // ####... 埋め文字は無視
    extra[k] = cleaned;
  }
  data.extra = extra;

  return { record: data };
}
