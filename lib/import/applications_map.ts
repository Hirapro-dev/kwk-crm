/**
 * 申込(applications)専用の取込変換ロジック (CLAUDE.md §5.6 / §6)
 *
 * 既存の移行スクリプト scripts/import/04_applications.ts と同じマッピングを再現:
 *   - 申込情報ID→id(必須)、投資案件→project_id(案件名解決)、会員ID→member_id(必須/既存のみ)
 *   - 問合せ管理ID→inquiry_id(任意/既存のみ)、永久担当/申込獲得者→owner/acquirer 名前解決
 *   - ステータス/入金区分はホワイトリスト、案件固有列は extra(JSONB)
 *   - application_date は 申込日 ?? 入金日(NOT NULL のため両方空はエラー)
 *
 * 純粋関数。DB アクセス(案件/会員/問合せ/担当の解決マップ)は action 側で構築して渡す。
 */

import { coerceValue, isCoerceErr } from './coerce';
import type { ImportFieldType } from './schema';

const ALLOWED_STATUS = new Set(['対応中', '未購入', '完了', '出金', '資金移動']);
const ALLOWED_FLOW = new Set(['入金', '出金', '資金移動', 'W']);

const DIRECT_FIELDS: Array<{ header: string; field: string; type: ImportFieldType }> = [
  { header: '契約書送付日', field: 'contract_sent_date', type: 'date' },
  { header: '起算月', field: 'start_month', type: 'text' },
  { header: '起算日時', field: 'start_datetime', type: 'datetime' },
  { header: '入金予定日', field: 'scheduled_payment_date', type: 'date' },
  { header: '入金予定額', field: 'scheduled_amount', type: 'number' },
  { header: '入金日', field: 'payment_date', type: 'date' },
  { header: '入金額', field: 'payment_amount', type: 'number' },
  { header: '仮想通貨除外分', field: 'crypto_excluded_amount', type: 'number' },
  { header: '円金利', field: 'yen_interest', type: 'number' },
  { header: '出金額', field: 'withdrawal_amount', type: 'number' },
  { header: '出金日', field: 'withdrawal_date', type: 'date' },
  { header: '資金移動日', field: 'transfer_date', type: 'date' },
  { header: '資金移動額', field: 'transfer_amount', type: 'number' },
  { header: '資金移動先', field: 'transfer_to', type: 'text' },
  { header: '契約期間', field: 'contract_period', type: 'text' },
];

/** 標準カラムとして消費(これら以外は extra)。会員氏名等の参照表示列も extra から除外。 */
const CONSUMED_HEADERS = new Set<string>([
  '申込情報ID', '投資案件', '会員ID', '会員氏名', '会員かな', '問合せ管理ID',
  'ステータス', 'ｽﾃｰﾀｽ', '入金/移動', '永久担当', '申込獲得者', 'メールアドレス',
  '紹介者名', '郵便番号', '住所', '申込日',
  ...DIRECT_FIELDS.map((f) => f.header),
]);

/**
 * CSV に現れたヘッダーのうち「標準カラムに消費されない列」= extra 行きの列名を返す。
 * ※ 値の有無に関わらずヘッダー基準で拾う(全行が空の新列も項目登録できるように)。
 */
export function applicationsExtraHeaderKeys(rawRows: Array<Record<string, string>>): string[] {
  const set = new Set<string>();
  for (const r of rawRows) {
    for (const k of Object.keys(r)) {
      if (k && k.trim() !== '' && !CONSUMED_HEADERS.has(k)) set.add(k);
    }
  }
  return [...set];
}

export const APPLICATION_TEMPLATE_HEADERS = [
  '申込情報ID', '投資案件', '会員ID', '問合せ管理ID', '申込日', 'ステータス',
  '入金/移動', '永久担当', '申込獲得者', '入金日', '入金額', '入金予定日', '入金予定額',
  '出金額', '出金日', '資金移動日', '資金移動額', '資金移動先', '起算月', '起算日時', '契約期間',
];

function nz(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function lenient(type: ImportFieldType, raw: unknown): string | number | boolean | null {
  const r = coerceValue(type, raw == null ? '' : String(raw));
  return isCoerceErr(r) ? null : r.value;
}

export interface AppResolveMaps {
  /** 案件名 → projects.id */
  projectNameToId: Map<string, string>;
  /** 既存 members.id */
  validMemberIds: Set<string>;
  /** 既存 inquiries.id */
  validInquiryIds: Set<string>;
  /** 担当者 full_name → users.id */
  ownerByFullName: Map<string, string>;
  /** 担当者 姓 → users.id */
  ownerByLastName: Map<string, string>;
}

export interface AppRecord {
  id: string;
  member_id: string;
  application_date: string;
  [key: string]: unknown;
}

export interface AppConvertOutcome {
  record?: AppRecord;
  error?: string;
}

function resolveOwner(name: string | null, maps: AppResolveMaps): string | null {
  if (!name || name === 'Free') return null;
  const byFull = maps.ownerByFullName.get(name);
  if (byFull) return byFull;
  const last = name.split(/[\s　]+/)[0];
  return last ? (maps.ownerByLastName.get(last) ?? null) : null;
}

export function convertApplicationRow(
  raw: Record<string, string>,
  rowNum: number,
  maps: AppResolveMaps,
): AppConvertOutcome {
  const id = nz(raw['申込情報ID']);
  if (!id) return { error: `${rowNum}行目: 申込情報ID が空です` };

  // 会員ID(必須・既存のみ)
  const memRaw = nz(raw['会員ID']);
  if (!memRaw) return { error: `${rowNum}行目: 会員ID が空です` };
  if (!maps.validMemberIds.has(memRaw)) {
    return { error: `${rowNum}行目: 会員ID「${memRaw}」が未登録です` };
  }

  // 申込日(NOT NULL): 申込日 ?? 入金日
  const appDate =
    (lenient('date', raw['申込日']) as string | null) ??
    (lenient('date', raw['入金日']) as string | null);
  if (!appDate) return { error: `${rowNum}行目: 申込日(または入金日) が必要です` };

  const headers = new Set(Object.keys(raw));
  const data: AppRecord = { id, member_id: memRaw, application_date: appDate };

  // 案件名 → project_id(NOT NULL のため未解決はエラーで除外)
  const projName = nz(raw['投資案件']);
  const projectId = projName ? (maps.projectNameToId.get(projName) ?? null) : null;
  if (!projectId) {
    return { error: `${rowNum}行目: 投資案件「${projName ?? '(空)'}」が案件マスタに未登録です` };
  }
  data.project_id = projectId;

  // 問合せ管理ID(任意・既存のみ)
  const inqRaw = nz(raw['問合せ管理ID']);
  data.inquiry_id = inqRaw && maps.validInquiryIds.has(inqRaw) ? inqRaw : null;

  // ステータス / 入出金区分(ホワイトリスト)
  const statusRaw = nz(raw['ステータス']) ?? nz(raw['ｽﾃｰﾀｽ']);
  data.status = statusRaw && ALLOWED_STATUS.has(statusRaw) ? statusRaw : null;
  const flow = nz(raw['入金/移動']);
  data.flow_type = flow && ALLOWED_FLOW.has(flow) ? flow : null;

  // 担当 / 申込獲得者
  const ownerRaw = nz(raw['永久担当']);
  data.owner_name_raw = ownerRaw;
  data.owner_id = resolveOwner(ownerRaw, maps);
  const acqRaw = nz(raw['申込獲得者']);
  data.acquirer_name_raw = acqRaw;
  data.acquirer_id = resolveOwner(acqRaw, maps);

  // 直接マッピング(CSVにある列のみ)
  for (const m of DIRECT_FIELDS) {
    if (headers.has(m.header)) data[m.field] = lenient(m.type, raw[m.header]);
  }

  // 案件固有列など未マッピングは extra へ
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (CONSUMED_HEADERS.has(k)) continue;
    const cleaned = nz(v);
    if (cleaned === null || /^#{7,}$/.test(cleaned)) continue;
    extra[k] = cleaned;
  }
  data.extra = extra;

  return { record: data };
}
