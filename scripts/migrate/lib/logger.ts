/**
 * 移行スクリプト共通: ロガー
 * 仕様書 §6.2: 進捗ログ出力。仕様書 §12.4: 個人情報をログに出さない(マスキング)
 */

const isoTs = () => new Date().toISOString();

export const logger = {
  info(msg: string, ctx?: Record<string, unknown>): void {
    console.log(`[${isoTs()}] INFO  ${msg}${ctx ? ` ${JSON.stringify(ctx)}` : ''}`);
  },
  warn(msg: string, ctx?: Record<string, unknown>): void {
    console.warn(`[${isoTs()}] WARN  ${msg}${ctx ? ` ${JSON.stringify(ctx)}` : ''}`);
  },
  error(msg: string, ctx?: Record<string, unknown>): void {
    console.error(`[${isoTs()}] ERROR ${msg}${ctx ? ` ${JSON.stringify(ctx)}` : ''}`);
  },
  progress(current: number, total: number, label = '進捗'): void {
    const pct = total > 0 ? ((current / total) * 100).toFixed(1) : '0.0';
    console.log(`[${isoTs()}] ${label}: ${current}/${total} (${pct}%)`);
  },
};

/**
 * 個人情報のマスキング(ログ用)。
 * email: a***@example.com
 * phone: 080****6789
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return '';
  const at = email.indexOf('@');
  if (at < 1) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at);
  return `${local[0]}***${domain}`;
}

export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  if (phone.length <= 4) return '****';
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}
