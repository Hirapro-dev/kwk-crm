/**
 * applications ドメインの client-safe な定数・型のみ。
 * lib/domain/applications.ts は server-only(createClient を import するため)。
 * Client Component はこのファイルから取る。
 */

export type AppStatus = '対応中' | '入金' | '出金' | '資金移動' | '完了' | '未購入' | '失効';

/**
 * 新規登録・変更で選べるステータス(2026-10-02 ユーザー指定。「完了」は「入金」に名前を変え、「未購入」「失効」は選択肢から外した)。
 */
export const APP_STATUSES: AppStatus[] = ['対応中', '入金', '出金', '資金移動'];

/** 過去の申込にだけ残る値。選択肢には出さないが、値はそのまま残す(ユーザー決定) */
export const LEGACY_APP_STATUSES: AppStatus[] = ['完了', '未購入', '失効'];

/** DB に入りうる全ステータス(一覧の絞り込み・既存値の検証用) */
export const ALL_APP_STATUSES: AppStatus[] = [...APP_STATUSES, ...LEGACY_APP_STATUSES];

/** 入金済みとみなすステータス(会員の利用額の計算に使う)。「完了」は「入金」の旧名 */
export const PAID_APP_STATUSES: AppStatus[] = ['入金', '完了'];

/** 利息種別(migration 121。2026-10-02)。利息(%)がどの期間あたりの率かを表す */
export type InterestType = '月利' | '年利' | '契約期間内';
export const INTEREST_TYPES: InterestType[] = ['月利', '年利', '契約期間内'];
