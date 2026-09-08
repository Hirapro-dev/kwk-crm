/**
 * SES 送信とドメイン検証状態の確認(CLAUDE.md §5.15)。サーバー専用。
 */

import { formatFromAddress } from '@/lib/domain/mail_compose';
import { GetEmailIdentityCommand, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { type MailAwsConfig, createSesClient } from './aws';

/** アドレスのドメイン部(小文字)。不正な形式なら null */
export function domainOf(address: string): string | null {
  const at = address.lastIndexOf('@');
  if (at < 0) return null;
  const d = address
    .slice(at + 1)
    .trim()
    .toLowerCase();
  return d || null;
}

/** ドメイン検証状態のキャッシュ。送信のたびに SES へ問い合わせないようにする */
const SENDABLE_TTL_MS = 5 * 60 * 1000;
const sendableCache = new Map<string, { ok: boolean; at: number }>();

/**
 * そのドメインから SES で送信できるか(= SES で ID 検証済みか)。
 * 未登録・未検証・確認失敗はすべて false(送信を止める側に倒す)。
 * 判定結果は 5 分キャッシュする。
 */
export async function isDomainSendable(cfg: MailAwsConfig, domain: string): Promise<boolean> {
  const hit = sendableCache.get(domain);
  if (hit && Date.now() - hit.at < SENDABLE_TTL_MS) return hit.ok;

  let ok = false;
  try {
    const ses = createSesClient(cfg);
    const r = await ses.send(new GetEmailIdentityCommand({ EmailIdentity: domain }));
    ok = r.VerifiedForSendingStatus === true;
  } catch {
    ok = false;
  }
  sendableCache.set(domain, { ok, at: Date.now() });
  return ok;
}

/** キャッシュを捨てる(設定画面で「再確認」する用途) */
export function clearSendableCache(): void {
  sendableCache.clear();
}

export interface SesSendInput {
  fromAddress: string;
  fromName?: string | null;
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  /** In-Reply-To / References 等。名前はそのまま渡す */
  headers?: Record<string, string>;
}

/**
 * SES v2 SendEmail(Simple)。戻り値は SES の MessageId。
 * 失敗は例外(呼び出し側で利用者向けの文言に変換する)。
 */
export async function sendViaSes(cfg: MailAwsConfig, input: SesSendInput): Promise<string> {
  const ses = createSesClient(cfg);
  const headers = Object.entries(input.headers ?? {})
    .filter(([, v]) => v && v.trim() !== '')
    .map(([Name, Value]) => ({ Name, Value }));

  const r = await ses.send(
    new SendEmailCommand({
      FromEmailAddress: formatFromAddress(input.fromAddress, input.fromName),
      ReplyToAddresses: [input.fromAddress],
      Destination: {
        ToAddresses: input.to,
        ...(input.cc && input.cc.length > 0 ? { CcAddresses: input.cc } : {}),
      },
      ...(cfg.configurationSet ? { ConfigurationSetName: cfg.configurationSet } : {}),
      Content: {
        Simple: {
          Subject: { Data: input.subject, Charset: 'UTF-8' },
          Body: { Text: { Data: input.text, Charset: 'UTF-8' } },
          ...(headers.length > 0 ? { Headers: headers } : {}),
        },
      },
    }),
  );
  if (!r.MessageId) throw new Error('SES から MessageId が返りませんでした');
  return r.MessageId;
}

/**
 * SES の例外を利用者向けの文言にする。原因の切り分けができる範囲で具体的に。
 */
export function describeSesError(e: unknown): string {
  const name = (e as { name?: string } | null)?.name ?? '';
  const msg = (e as { message?: string } | null)?.message ?? '';
  if (/not verified/i.test(msg) || name === 'MessageRejected') {
    return 'SES がサンドボックス状態のため、検証済みアドレス以外には送れません(サンドボックス解除の申請が必要です)';
  }
  if (name === 'NotFoundException') {
    return '送信元ドメインが SES に登録されていません';
  }
  if (name === 'AccountSuspendedException') {
    return 'SES アカウントが停止されています';
  }
  if (name === 'SendingPausedException') {
    return 'SES の送信が一時停止されています';
  }
  if (name === 'LimitExceededException' || name === 'TooManyRequestsException') {
    return '送信数の上限に達しました。しばらく待ってから再試行してください';
  }
  return `送信に失敗しました${name ? ` (${name})` : ''}`;
}
