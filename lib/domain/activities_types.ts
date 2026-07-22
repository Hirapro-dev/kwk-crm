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

/**
 * 接触内容(中分類 m_bunrui) 固定選択肢。
 * 入力フォーム(components/activities/ActivityForm.tsx CONTACT_CONTENTS)と一致させること。
 */
export const CONTACT_CONTENTS = ['営業', '営業サポート', 'サポートチーム対応'] as const;

/**
 * 状態(小分類 s_bunrui)フラグ。s_bunrui にパイプ区切りで格納されるため、
 * フィルタでは部分一致(contains)で判定する。
 */
export const ACTIVITY_STATUS_FLAGS = ['通電', '不在', '接触対応', '申込獲得'] as const;
