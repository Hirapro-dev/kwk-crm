/**
 * applications ドメインの client-safe な定数・型のみ。
 * lib/domain/applications.ts は server-only(createClient を import するため)。
 * Client Component はこのファイルから取る。
 */

export type AppStatus = '対応中' | '未購入' | '完了' | '出金' | '資金移動' | '失効';
export type FlowType = '入金' | '出金' | '資金移動' | 'W';

export const APP_STATUSES: AppStatus[] = ['対応中', '未購入', '完了', '出金', '資金移動', '失効'];

export const FLOW_TYPES: FlowType[] = ['入金', '出金', '資金移動', 'W'];

/** 利息種別(migration 121。2026-10-02)。利息(%)がどの期間あたりの率かを表す */
export type InterestType = '月利' | '年利' | '契約期間内';
export const INTEREST_TYPES: InterestType[] = ['月利', '年利', '契約期間内'];
