/**
 * SES の送信ドメイン ID(検証状態の取得・登録)。サーバー専用。CLAUDE.md §5.15 M2。
 *
 * `/settings/mail` から使う。ドメインの登録(CreateEmailIdentity)は Easy DKIM(RSA 2048)で行い、
 * 返ってきた DKIM トークンを画面に出して DNS に貼ってもらう。DNS の追加自体は自動化できない
 * (Xserver 等に API が無い)ため、ここでやるのは「登録」と「状態の確認」まで。
 */

import {
  CreateEmailIdentityCommand,
  GetEmailIdentityCommand,
  NotFoundException,
} from '@aws-sdk/client-sesv2';
import { type MailAwsConfig, createSesClient } from './aws';
import { clearSendableCache } from './ses_send';

export type DomainIdentityStatus =
  /** SES に ID が無い */
  | 'unregistered'
  /** 登録済みだが DKIM の CNAME が DNS で確認できていない */
  | 'pending'
  /** 検証済み(送信可) */
  | 'verified'
  /** DKIM の確認に失敗した(SES 側で FAILED / TEMPORARY_FAILURE) */
  | 'failed'
  /** SES への問い合わせに失敗(権限不足・ネットワーク等) */
  | 'unknown';

export interface DomainIdentity {
  domain: string;
  status: DomainIdentityStatus;
  /** Easy DKIM のトークン(CNAME 3本のホスト名の元)。未登録・取得失敗時は空 */
  dkimTokens: string[];
  /** unknown のときの原因(利用者向け) */
  detail?: string;
}

function toStatus(r: {
  VerifiedForSendingStatus?: boolean;
  DkimAttributes?: { Status?: string };
}): DomainIdentityStatus {
  if (r.VerifiedForSendingStatus === true) return 'verified';
  const s = r.DkimAttributes?.Status ?? '';
  if (s === 'FAILED' || s === 'TEMPORARY_FAILURE') return 'failed';
  return 'pending';
}

/** ドメインの SES 登録状態を取得する。失敗しても例外にせず status で返す */
export async function getDomainIdentity(
  cfg: MailAwsConfig,
  domain: string,
): Promise<DomainIdentity> {
  const ses = createSesClient(cfg);
  try {
    const r = await ses.send(new GetEmailIdentityCommand({ EmailIdentity: domain }));
    return { domain, status: toStatus(r), dkimTokens: r.DkimAttributes?.Tokens ?? [] };
  } catch (e) {
    if (e instanceof NotFoundException || (e as { name?: string })?.name === 'NotFoundException') {
      return { domain, status: 'unregistered', dkimTokens: [] };
    }
    return { domain, status: 'unknown', dkimTokens: [], detail: describeIdentityError(e) };
  }
}

/**
 * ドメインを SES に登録し(Easy DKIM / RSA 2048)、DKIM トークンを返す。
 * 既に登録済み(AlreadyExists)なら現在の状態を返す。
 */
export async function registerDomainIdentity(
  cfg: MailAwsConfig,
  domain: string,
): Promise<DomainIdentity> {
  const ses = createSesClient(cfg);
  try {
    const r = await ses.send(
      new CreateEmailIdentityCommand({
        EmailIdentity: domain,
        DkimSigningAttributes: { NextSigningKeyLength: 'RSA_2048_BIT' },
      }),
    );
    clearSendableCache();
    return {
      domain,
      status: r.VerifiedForSendingStatus ? 'verified' : 'pending',
      dkimTokens: r.DkimAttributes?.Tokens ?? [],
    };
  } catch (e) {
    if ((e as { name?: string })?.name === 'AlreadyExistsException') {
      return getDomainIdentity(cfg, domain);
    }
    throw new Error(describeIdentityError(e));
  }
}

/** SES の例外を利用者向けの文言にする(認証情報や ARN は出さない) */
export function describeIdentityError(e: unknown): string {
  const name = (e as { name?: string } | null)?.name ?? '';
  if (name === 'AccessDeniedException') {
    return 'AWS の権限が不足しています(IAM ポリシーに ses:CreateEmailIdentity / ses:GetEmailIdentity が必要です)';
  }
  if (name === 'BadRequestException') {
    return 'ドメインの形式が SES に受け付けられませんでした';
  }
  if (name === 'LimitExceededException' || name === 'TooManyRequestsException') {
    return 'SES の上限に達しました。しばらく待ってから再試行してください';
  }
  return `SES への問い合わせに失敗しました${name ? ` (${name})` : ''}`;
}
