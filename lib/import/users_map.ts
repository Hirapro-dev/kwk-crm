/**
 * 従業員(users)専用の取込変換ロジック (CLAUDE.md §5.1 / §6)
 *
 * - email 必須(小文字化)。突合は legacy_sf_id → email の順で既存 id を再利用、
 *   無ければ新規 UUID を採番(id は uuid PK・既定値なし)
 * - role は admin/manager/sales/viewer のいずれかにマッピング(不明は viewer)
 * - 氏名は full_name、無ければ「姓 名」で補完
 *
 * Salesforce 標準列(Id/Email/FirstName/LastName/Name/IsActive/UserRole.Name)にも対応。
 * 純粋関数。既存ユーザーの突合マップは action 側で構築して渡す。
 */

import { randomUUID } from 'node:crypto';

type Role = 'admin' | 'manager' | 'sales' | 'viewer';

const ALIASES: Record<string, string[]> = {
  legacy_sf_id: ['ユーザーID', 'Id', 'legacy_sf_id'],
  email: ['メール', 'メールアドレス', 'Email', 'email'],
  first_name: ['名', 'FirstName', 'first_name'],
  last_name: ['姓', 'LastName', 'last_name'],
  full_name: ['氏名', 'Name', 'full_name'],
  is_active: ['有効', 'IsActive', 'is_active'],
  role: ['権限', 'ロール', 'UserRole.Name', 'role'],
};

export const USER_LEGACY_HEADERS = ALIASES.legacy_sf_id;
export const USER_EMAIL_HEADERS = ALIASES.email;

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

function parseBool(v: string | null): boolean {
  if (v === null) return true; // 既定は有効
  const s = v.toLowerCase();
  if (['false', '0', 'no', '無効', '非有効', 'inactive'].includes(s)) return false;
  return true;
}

function mapRole(roleName: string | null): Role {
  if (!roleName) return 'viewer';
  const r = roleName.toLowerCase();
  if (r.includes('admin') || r.includes('管理')) return 'admin';
  if (r.includes('manager') || r.includes('マネージャ') || r.includes('役員')) return 'manager';
  if (r.includes('sales') || r.includes('営業')) return 'sales';
  if (['admin', 'manager', 'sales', 'viewer'].includes(r)) return r as Role;
  return 'viewer';
}

export interface UserResolveMaps {
  /** legacy_sf_id → users.id */
  idByLegacy: Map<string, string>;
  /** email(小文字) → users.id */
  idByEmail: Map<string, string>;
}

export interface UserRecord {
  id: string;
  legacy_sf_id: string | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  is_active: boolean;
  role: Role;
}

export interface UserConvertOutcome {
  record?: UserRecord;
  /** 既存ユーザーか(プレビューの新規/更新判定用) */
  existed?: boolean;
  /** 同一ユーザーをまとめるためのキー(legacy_sf_id ?? email) */
  dedupKey?: string;
  error?: string;
}

export function convertUserRow(
  raw: Record<string, string>,
  rowNum: number,
  maps: UserResolveMaps,
): UserConvertOutcome {
  const email = pick(raw, 'email');
  if (!email) return { error: `${rowNum}行目: メール(email)が空です` };
  const emailLc = email.toLowerCase();

  const legacy = pick(raw, 'legacy_sf_id');

  // 既存 id を突合(legacy → email)。無ければ新規 UUID。
  const existingId =
    (legacy ? maps.idByLegacy.get(legacy) : undefined) ?? maps.idByEmail.get(emailLc) ?? null;
  const id = existingId ?? randomUUID();

  const firstName = pick(raw, 'first_name');
  const lastName = pick(raw, 'last_name');
  const fullName =
    pick(raw, 'full_name') ??
    (lastName && firstName ? `${lastName} ${firstName}` : (lastName ?? firstName ?? null));

  return {
    record: {
      id,
      legacy_sf_id: legacy,
      email: emailLc,
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      is_active: parseBool(pick(raw, 'is_active')),
      role: mapRole(pick(raw, 'role')),
    },
    existed: existingId !== null,
    dedupKey: legacy ?? emailLc,
  };
}
