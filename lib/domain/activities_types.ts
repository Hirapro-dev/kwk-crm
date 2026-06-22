/**
 * activities ドメインの client-safe な型のみ。
 * lib/domain/activities.ts は server-only(createClient を import するため)。
 * Client Component はこのファイルから型を取る。
 */

export interface BunruiPair {
  d_bunrui: string;
  m_bunrui: string | null;
  s_bunrui: string | null;
}
