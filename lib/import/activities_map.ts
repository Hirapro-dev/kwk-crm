/**
 * 対応歴(activities)専用の取込変換ロジック (CLAUDE.md §5.7 / §6)
 *
 * - 会員ID(K-)→member_id(既存のみ・無ければ null)、担当→owner_id(名前解決)
 * - 接触種別/接触内容/状態・対応詳細・登録日時を直接マッピング
 * - activities には extra 列が無いため、未マッピング列は無視する
 * - ID列が無いことが多いので、行内容のハッシュで legacy_sf_id を生成して突合
 *   (同一内容の行は同じ legacy_sf_id → upsert で重複しない)
 *   「対応歴ID / Id / legacy_sf_id」列があればそれを優先
 *
 * 実 CSV(extract.csv)の列名(Dbunrui__c / WhoId / OwnerId / tourokunitiji__c 等)にも対応。
 * 純粋関数。担当解決マップ・既存会員IDは action 側で構築して渡す。
 */

import { createHash } from 'node:crypto';
import { coerceValue, isCoerceErr } from './coerce';
import type { ImportFieldType } from './schema';

/** 会員ID列の別名(action 側で「会員ID列の distinct」を取るのにも使う) */
export const ACTIVITY_MEMBER_HEADERS = ['会員ID', 'WhoId', 'member_id'];

/** フィールドごとの許容ヘッダー(先に一致したものを採用) */
const ALIASES: Record<string, string[]> = {
  legacy_sf_id: ['対応歴ID', 'Id', 'legacy_sf_id'],
  member_id: ACTIVITY_MEMBER_HEADERS,
  owner_name: ['担当', '担当者', 'OwnerId', 'owner'],
  created_by_name: ['作成者', 'CreatedById'],
  d_bunrui: ['大分類', 'Dbunrui__c', 'd_bunrui'],
  m_bunrui: ['中分類', 'Mbunrui__c', 'm_bunrui'],
  s_bunrui: ['小分類', 'Sbunrui__c', 's_bunrui'],
  description: ['対応詳細', 'コメント', '内容', '対応内容', 'Description', 'description'],
  registered_datetime: ['登録日時', 'tourokunitiji__c', 'ActivityDateTime', 'registered_datetime'],
  registered_date: ['登録日', 'tourokuhi__c', 'ActivityDate', 'registered_date'],
};

function nz(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function pick(raw: Record<string, string>, field: string): string | null {
  for (const h of ALIASES[field] ?? []) {
    if (h in raw) {
      const v = nz(raw[h]);
      if (v !== null) return v;
    }
  }
  return null;
}

function lenient(type: ImportFieldType, raw: unknown): string | number | boolean | null {
  const r = coerceValue(type, raw == null ? '' : String(raw));
  return isCoerceErr(r) ? null : r.value;
}

export interface ActivityResolveMaps {
  /** 既存 members.id */
  validMemberIds: Set<string>;
  /** 担当者 full_name → users.id */
  ownerByFullName: Map<string, string>;
  /** 担当者 姓 → users.id */
  ownerByLastName: Map<string, string>;
}

export interface ActivityRecord {
  legacy_sf_id: string;
  owner_id: string | null;
  member_id: string | null;
  created_by_id: string | null;
  description: string | null;
  d_bunrui: string | null;
  m_bunrui: string | null;
  s_bunrui: string | null;
  registered_date: string | null;
  registered_datetime: string | null;
}

export interface ActivityConvertOutcome {
  record?: ActivityRecord;
  error?: string;
}

function resolveOwner(name: string | null, maps: ActivityResolveMaps): string | null {
  if (!name || name === 'Free') return null;
  const byFull = maps.ownerByFullName.get(name);
  if (byFull) return byFull;
  const last = name.split(/[\s　]+/)[0];
  return last ? (maps.ownerByLastName.get(last) ?? null) : null;
}

export function convertActivityRow(
  raw: Record<string, string>,
  rowNum: number,
  maps: ActivityResolveMaps,
): ActivityConvertOutcome {
  const memberRaw = pick(raw, 'member_id');
  const memberId = memberRaw && maps.validMemberIds.has(memberRaw) ? memberRaw : null;

  const ownerName = pick(raw, 'owner_name');
  const createdByName = pick(raw, 'created_by_name');

  const description = pick(raw, 'description');
  const dB = pick(raw, 'd_bunrui');
  const mB = pick(raw, 'm_bunrui');
  const sB = pick(raw, 's_bunrui');
  const dt = lenient('datetime', pick(raw, 'registered_datetime')) as string | null;
  const date = lenient('date', pick(raw, 'registered_date')) as string | null;

  // 完全に空の行はスキップ(エラー扱い)
  if (!memberRaw && !ownerName && !description && !dB && !mB && !sB && !dt && !date) {
    return { error: `${rowNum}行目: 取込対象の値がありません(空行)` };
  }

  // legacy_sf_id: 明示IDがあれば優先、無ければ行内容のハッシュで生成(重複防止)
  const explicitId = pick(raw, 'legacy_sf_id');
  const dedupKey = [memberId, dB, mB, sB, description, dt ?? date, ownerName].join('|');
  const legacyId =
    explicitId ?? `act_${createHash('sha256').update(dedupKey).digest('hex').slice(0, 24)}`;

  return {
    record: {
      legacy_sf_id: legacyId,
      owner_id: resolveOwner(ownerName, maps),
      member_id: memberId,
      created_by_id: resolveOwner(createdByName, maps),
      description,
      d_bunrui: dB,
      m_bunrui: mB,
      s_bunrui: sB,
      registered_date: date,
      registered_datetime: dt,
    },
  };
}
