/**
 * SES 送信とドメイン検証状態の確認(CLAUDE.md §5.15)。サーバー専用。
 */

import { formatFromAddress } from '@/lib/domain/mail_compose';
import {
  type SesIdentitySummary,
  isSesThrottle,
  runWithConcurrency,
  verifiedDomainsFromIdentities,
} from '@/lib/domain/mail_sendable';
import {
  GetEmailIdentityCommand,
  ListEmailIdentitiesCommand,
  SendEmailCommand,
} from '@aws-sdk/client-sesv2';
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

/**
 * ドメイン検証状態のキャッシュ。送信のたびに SES へ問い合わせないようにする。
 * 2026-10-23: 返信・新規作成の画面が受信箱(約 660 件)ごとに同時に問い合わせて SES に断られ、確認失敗を「送信不可」として
 * 5 分覚えていたため、検証済みのドメインまで「受信専用」と出ていた。いまは
 *   1. ID の一覧(ListEmailIdentities)を 1 回取って全ドメインの状態を得る(IAM に ses:ListEmailIdentities が要る)
 *   2. 一覧が取れなければ、ドメインごとに 1 回だけ・同時に数件ずつ問い合わせ、断られたら少し待ってやり直す
 *   3. 確認に失敗した結果は 30 秒しか覚えない(確定した結果は 5 分)
 */
const SENDABLE_TTL_MS = 5 * 60 * 1000;
const FAILURE_TTL_MS = 30 * 1000;
/** 一覧が取れないときに、同時にドメインを問い合わせる数 */
const PER_DOMAIN_CONCURRENCY = 3;
const THROTTLE_RETRIES = 3;
const sendableCache = new Map<string, { ok: boolean; at: number; ttl: number }>();
const inflight = new Map<string, Promise<boolean>>();
let listCache: { at: number; verified: Set<string> } | null = null;
let listUnavailableAt: number | null = null;
let listInflight: Promise<Set<string> | null> | null = null;

/** 送信できるドメインの一覧(ListEmailIdentities)。取れなければ null(権限が無い・失敗) */
async function loadVerifiedDomainList(cfg: MailAwsConfig): Promise<Set<string> | null> {
  const now = Date.now();
  if (listCache && now - listCache.at < SENDABLE_TTL_MS) return listCache.verified;
  if (listUnavailableAt !== null && now - listUnavailableAt < SENDABLE_TTL_MS) return null;
  if (listInflight) return listInflight;
  listInflight = (async () => {
    try {
      const ses = createSesClient(cfg);
      const items: SesIdentitySummary[] = [];
      let token: string | undefined;
      do {
        const r = await ses.send(
          new ListEmailIdentitiesCommand({ PageSize: 1000, NextToken: token }),
        );
        items.push(...(r.EmailIdentities ?? []));
        token = r.NextToken;
      } while (token);
      const verified = verifiedDomainsFromIdentities(items);
      listCache = { at: Date.now(), verified };
      listUnavailableAt = null;
      return verified;
    } catch {
      listUnavailableAt = Date.now();
      return null;
    } finally {
      listInflight = null;
    }
  })();
  return listInflight;
}

/** 1 ドメインを問い合わせる。definite = 結果が確定した(未登録も確定) */
async function checkDomain(
  cfg: MailAwsConfig,
  domain: string,
): Promise<{ ok: boolean; definite: boolean }> {
  const ses = createSesClient(cfg);
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await ses.send(new GetEmailIdentityCommand({ EmailIdentity: domain }));
      return { ok: r.VerifiedForSendingStatus === true, definite: true };
    } catch (e) {
      if (isSesThrottle(e) && attempt < THROTTLE_RETRIES) {
        await new Promise((res) => setTimeout(res, 200 * 2 ** attempt));
        continue;
      }
      if ((e as { name?: string }).name === 'NotFoundException')
        return { ok: false, definite: true };
      return { ok: false, definite: false };
    }
  }
}

/**
 * そのドメインから SES で送信できるか(= SES で ID 検証済みか)。
 * 未登録・未検証・確認失敗はすべて false(送信を止める側に倒す)。
 */
export async function isDomainSendable(cfg: MailAwsConfig, domain: string): Promise<boolean> {
  const d = domain.trim().toLowerCase();
  const hit = sendableCache.get(d);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.ok;

  const list = await loadVerifiedDomainList(cfg);
  if (list) {
    const ok = list.has(d);
    sendableCache.set(d, { ok, at: Date.now(), ttl: SENDABLE_TTL_MS });
    return ok;
  }

  // 同じドメインの問い合わせが進行中ならそれを待つ(同時に何度も聞かない)
  let p = inflight.get(d);
  if (!p) {
    p = checkDomain(cfg, d)
      .then((r) => {
        sendableCache.set(d, {
          ok: r.ok,
          at: Date.now(),
          ttl: r.definite ? SENDABLE_TTL_MS : FAILURE_TTL_MS,
        });
        return r.ok;
      })
      .finally(() => inflight.delete(d));
    inflight.set(d, p);
  }
  return p;
}

/**
 * 複数のアドレスのドメインについて送信できるかをまとめて調べる(返信・新規作成の送信元の候補用)。
 * ドメインごとに 1 回だけ、同時に数件ずつ問い合わせる。キーは小文字のドメイン。
 */
export async function sendableDomainMap(
  cfg: MailAwsConfig,
  addresses: readonly string[],
): Promise<Map<string, boolean>> {
  const domains = [
    ...new Set(addresses.map((a) => domainOf(a)).filter((d): d is string => d !== null)),
  ];
  const results = await runWithConcurrency(domains, PER_DOMAIN_CONCURRENCY, (d) =>
    isDomainSendable(cfg, d),
  );
  return new Map(domains.map((d, i) => [d, results[i] === true]));
}

/** キャッシュを捨てる(設定画面で「再確認」する用途) */
export function clearSendableCache(): void {
  sendableCache.clear();
  listCache = null;
  listUnavailableAt = null;
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
 * SES v2 SendEmail(Raw)。添付付きメール(raw_message.ts で組み立てた MIME)を送る。戻り値は SES の MessageId。
 * 宛先は MIME のヘッダと同じものを Destination にも渡す。失敗は例外。
 */
export async function sendRawViaSes(
  cfg: MailAwsConfig,
  input: { raw: Buffer; to: string[]; cc?: string[] },
): Promise<string> {
  const ses = createSesClient(cfg);
  const r = await ses.send(
    new SendEmailCommand({
      Destination: {
        ToAddresses: input.to,
        ...(input.cc && input.cc.length > 0 ? { CcAddresses: input.cc } : {}),
      },
      ...(cfg.configurationSet ? { ConfigurationSetName: cfg.configurationSet } : {}),
      Content: { Raw: { Data: new Uint8Array(input.raw) } },
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
