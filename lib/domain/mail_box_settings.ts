/**
 * `/mail/settings`(受信箱・送信ドメインの設定)の決定論的ロジック。CLAUDE.md §5.15 / §0.1 R6。
 * 純粋関数のみ。SES や DB には触れない(それは lib/mail/ses_identity.ts と mail_box_actions.ts)。
 */

import { domainOfAddress } from './mail_folders';

const ADDRESS_RE = /^[^\s@<>,;"'()]+@[^\s@<>,;"'()]+\.[^\s@<>,;"'()]+$/;
const MAX_ADDRESS_LENGTH = 254;

/**
 * 受信箱として登録するアドレスを正規化する。
 * 小文字化・前後空白除去。形式が不正なら error。
 * 小文字化するのは、受信時の宛先判定(mail_boxes.address との完全一致)が小文字比較のため。
 */
export function normalizeMailBoxAddress(input: string | null | undefined): {
  address: string;
  error?: string;
} {
  const a = (input ?? '').trim().toLowerCase();
  if (!a) return { address: '', error: 'メールアドレスを入力してください' };
  if (a.length > MAX_ADDRESS_LENGTH) return { address: '', error: 'メールアドレスが長すぎます' };
  if (!ADDRESS_RE.test(a)) return { address: '', error: `メールアドレスの形式が不正です: ${a}` };
  return { address: a };
}

export interface DnsRecordToAdd {
  /** DNS に登録するホスト名(FQDN) */
  host: string;
  /** サブドメイン部分だけ(Xserver の入力欄はドメインが固定で付くため) */
  hostLabel: string;
  type: 'CNAME';
  value: string;
}

/**
 * SES の Easy DKIM トークンから、DNS に追加する CNAME 3本を組み立てる。
 * 形式は SES の仕様どおり `<token>._domainkey.<domain> CNAME <token>.dkim.amazonses.com`。
 */
export function dkimCnameRecords(domain: string, tokens: readonly string[]): DnsRecordToAdd[] {
  return tokens.map((t) => ({
    host: `${t}._domainkey.${domain}`,
    hostLabel: `${t}._domainkey`,
    type: 'CNAME',
    value: `${t}.dkim.amazonses.com`,
  }));
}

/** 受信箱一覧から、設定画面に出すドメインの一覧(重複なし・昇順) */
export function uniqueDomains(addresses: readonly string[]): string[] {
  const set = new Set<string>();
  for (const a of addresses) {
    const d = domainOfAddress(a);
    if (d) set.add(d);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}
