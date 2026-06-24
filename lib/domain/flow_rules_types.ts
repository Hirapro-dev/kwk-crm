/**
 * FlowRule の型定義と純粋ユーティリティ。
 * サーバー専用モジュールへの依存がないため、クライアントコンポーネントから安全にインポートできる。
 */

export type DurationType = 'days_at_time' | 'hours';

export interface FlowRule {
  id: number;
  name: string;
  trigger_flag: string;
  duration_type: DurationType;
  duration_value: number;
  reset_hour: number;
  reset_minute: number;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** 有効期限を計算する */
export function calcExpiresAt(rule: FlowRule): Date {
  const now = new Date();

  if (rule.duration_type === 'hours') {
    return new Date(now.getTime() + rule.duration_value * 60 * 60 * 1000);
  }

  // days_at_time: N日後の reset_hour:reset_minute JST
  //
  // サーバーは UTC で動作するため、JST 空間での日付計算が必要。
  // UTC+9 のオフセットを加算した "JST 日時を UTC 値として保持する Date" を作り、
  // そこで日付加算・時刻セットを行ってから UTC に戻す。
  //
  // 旧実装の問題: setDate(getDate()+N) は UTC 日付で加算し、その後
  //   setUTCHours((reset_hour-9+24)%24) で時刻を補正するが、
  //   reset_hour=0 の場合 utcHour=15 となり「UTC N日後の15:00 = JST N+1日後の0:00」
  //   になってしまい、実際より1日長くなる。
  const JST_MS = 9 * 60 * 60 * 1000;

  // 現在時刻を JST 相当の "フェイク UTC" に変換
  const nowAsJst = new Date(now.getTime() + JST_MS);

  // JST 空間で N 日後の指定時刻を組み立て
  const targetAsJst = new Date(nowAsJst);
  targetAsJst.setUTCDate(targetAsJst.getUTCDate() + rule.duration_value);
  targetAsJst.setUTCHours(rule.reset_hour, rule.reset_minute, 0, 0);

  // "フェイク UTC" → 本来の UTC に戻す
  const result = new Date(targetAsJst.getTime() - JST_MS);

  // 端ケース: 計算結果が現在以前になる場合は 1 日追加
  if (result <= now) {
    targetAsJst.setUTCDate(targetAsJst.getUTCDate() + 1);
    return new Date(targetAsJst.getTime() - JST_MS);
  }

  return result;
}

/** duration_type と値を日本語表記に変換 */
export function formatDuration(rule: FlowRule): string {
  if (rule.duration_type === 'hours') {
    return `${rule.duration_value}時間後`;
  }
  const h = String(rule.reset_hour).padStart(2, '0');
  const m = String(rule.reset_minute).padStart(2, '0');
  return `${rule.duration_value}日後の${h}:${m}`;
}
