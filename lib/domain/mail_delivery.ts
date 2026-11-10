/**
 * 送信メールの配信状態の表示(CLAUDE.md §5.15)。純粋関数。
 * 値(mail_messages.delivery_status)は SES の通知で更新される英語のまま保存し、画面では日本語で出す。
 * スレッド画面の送信メールの見出しと、送信済み一覧の両方で使う。
 */

export const DELIVERY_STATUS_LABELS: Readonly<Record<string, string>> = {
  /** 送った直後で、配信の結果の通知をまだ受け取っていない */
  queued: '配信確認中',
  sent: '送信済み',
  delivered: '配信済み',
  bounced: '不達',
  failed: '失敗',
};

/** 配信状態の日本語表示。知らない値はそのまま、値が無ければ空文字 */
export function deliveryStatusLabel(status: string | null | undefined): string {
  if (!status) return '';
  return DELIVERY_STATUS_LABELS[status] ?? status;
}

/** 赤字で目立たせる状態(不達・失敗) */
export function isDeliveryProblem(status: string | null | undefined): boolean {
  return status === 'bounced' || status === 'failed';
}
