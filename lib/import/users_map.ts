/**
 * 従業員(users)専用の取込変換ロジック (CLAUDE.md §5.1 / §6)
 *
 * - email 必須(小文字化)。突合は legacy_sf_id → email の順で既存 id を再利用、
 *   無ければ新規 UUID を採番(id は uuid PK・既定値なし)
 * - role は admin/manager/sales/support/viewer のいずれかにマッピング
 * - 既存ユーザーは、CSV に値がある項目だけを変える(列が無い・空・解釈できないロールは既存の値を残す。2026-11-11)
 *   以前は権限の列が無いだけで既存ユーザーを viewer に落としていた(取込を実行した admin 本人も)
 * - 新しいユーザーは、ロールが読めなければ viewer・有効で作る
 * - 氏名は full_name、無ければ「姓 名」で補完
 *
 * Salesforce 標準列(Id/Email/FirstName/LastName/Name/IsActive/UserRole.Name)にも対応。
 * 純粋関数。既存ユーザーの突合マップは action 側で構築して渡す。
 */

type Role = 'admin' | 'manager' | 'sales' | 'support' | 'viewer';

/** UUID 生成(Node18+/Edge どちらでも使える Web Crypto グローバル)。 */
function newUuid(): string {
  return globalThis.crypto.randomUUID();
}

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

/** 有効 / 無効を読む。空なら null(呼び出し側が既存の値か既定の「有効」を使う) */
function parseBool(v: string | null): boolean | null {
  if (v === null) return null;
  const s = v.toLowerCase();
  if (['false', '0', 'no', '無効', '非有効', 'inactive'].includes(s)) return false;
  return true;
}

/** ロール名を読む。空・解釈できない値は null(呼び出し側が既存のロールか viewer を使う) */
function mapRole(roleName: string | null): Role | null {
  if (!roleName) return null;
  const r = roleName.toLowerCase();
  if (r.includes('admin') || r.includes('管理')) return 'admin';
  if (r.includes('manager') || r.includes('マネージャ') || r.includes('役員')) return 'manager';
  if (r.includes('support') || r.includes('サポート')) return 'support';
  if (r.includes('sales') || r.includes('営業')) return 'sales';
  if (r.includes('viewer') || r.includes('閲覧')) return 'viewer';
  return null;
}

export interface UserResolveMaps {
  /** legacy_sf_id → users.id */
  idByLegacy: Map<string, string>;
  /** email(小文字) → users.id */
  idByEmail: Map<string, string>;
  /** users.id → 既存の値(CSV に値が無い項目はこれを残す) */
  existingById?: Map<string, ExistingUser>;
}

export interface ExistingUser {
  legacy_sf_id: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  is_active: boolean;
  role: Role;
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
  const id = existingId ?? newUuid();
  const ex = existingId ? maps.existingById?.get(existingId) : undefined;

  const firstName = pick(raw, 'first_name');
  const lastName = pick(raw, 'last_name');
  const fullName =
    pick(raw, 'full_name') ??
    (lastName && firstName ? `${lastName} ${firstName}` : (lastName ?? firstName ?? null));

  return {
    record: {
      id,
      legacy_sf_id: legacy ?? ex?.legacy_sf_id ?? null,
      email: emailLc,
      first_name: firstName ?? ex?.first_name ?? null,
      last_name: lastName ?? ex?.last_name ?? null,
      full_name: fullName ?? ex?.full_name ?? null,
      is_active: parseBool(pick(raw, 'is_active')) ?? ex?.is_active ?? true,
      role: mapRole(pick(raw, 'role')) ?? ex?.role ?? 'viewer',
    },
    existed: existingId !== null,
    dedupKey: legacy ?? emailLc,
  };
}
