/**
 * applications ドメインの client-safe な定数・型のみ。
 * lib/domain/applications.ts は server-only(createClient を import するため)。
 * Client Component はこのファイルから取る。
 */

export type AppStatus = '対応中' | '未購入' | '完了' | '出金' | '資金移動';
export type FlowType = '入金' | '出金' | '資金移動' | 'W';

export const APP_STATUSES: AppStatus[] = ['対応中', '未購入', '完了', '出金', '資金移動'];

export const FLOW_TYPES: FlowType[] = ['入金', '出金', '資金移動', 'W'];
