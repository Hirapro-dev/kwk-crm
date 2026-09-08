/**
 * メール受信の決定論的ロジック(CLAUDE.md §5.15 / §0.1 R6)。
 *
 * Webhook 受信ハンドラ(app/api/mail/inbound/route.ts)から使う純粋関数を集める。
 * DB アクセス・外部 API 呼び出しは行わない(ユニットテストで固定するため)。
 *
 * ここで決めていること:
 *   - アドレス表記 "氏名 <addr>" の分解と小文字化(会員突合は完全一致のため)
 *   - 件名の Re:/Fw: 除去(スレッドの表示件名に使う。突合には使わない)
 *   - In-Reply-To / References から Message-ID を取り出す(スレッド判定の入力)
 *   - Message-ID が無いメールへの ID 付与(mail_messages.message_id は NOT NULL UNIQUE)
 *   - 受信用アドレス宛かの検証と、元の宛先による受信箱の特定(数百アドレスを1つの転送先で受ける)
 */

import { randomUUID } from 'node:crypto';

export interface ParsedAddress {
  /** 小文字化・前後空白除去済みのアドレス */
  address: string;
  /** 表示名(無ければ null)。前後のダブルクォートは外す */
  name: string | null;
}

/**
 * "山田 太郎 <taro@example.com>" / "<taro@example.com>" / "taro@example.com" を分解する。
 * 会員突合(members.email1〜3 との完全一致)のため、アドレスは常に小文字にする。
 * 解析できない文字列は address='' を返す(呼び出し側で無視 or 原文保持を判断)。
 */
export function parseAddress(raw: string | null | undefined): ParsedAddress {
  const s = (raw ?? '').trim();
  if (!s) return { address: '', name: null };

  const m = s.match(/^(.*?)\s*<([^<>]+)>\s*$/);
  if (m) {
    const name = (m[1] ?? '')
      .trim()
      .replace(/^"(.*)"$/, '$1')
      .trim();
    return { address: (m[2] ?? '').trim().toLowerCase(), name: name || null };
  }
  // 山括弧なし = アドレスのみ
  return { address: s.toLowerCase(), name: null };
}

/**
 * 件名から返信・転送の接頭辞を取り除く(繰り返しにも対応)。
 *   "Re: Re: 【お問合せ】..." → "【お問合せ】..."
 *   "RE: FW: 件名" / "返信: 件名" / "転送: 件名" / "Re[2]: 件名" も対象。
 * スレッド一覧の表示用。スレッド判定には使わない(§5.15: 件名では結合しない)。
 */
export function normalizeSubject(raw: string | null | undefined): string {
  let s = (raw ?? '').replace(/\s+/g, ' ').trim();
  const prefix = /^(?:(?:re|fw|fwd|aw|wg|返信|転送)(?:\[\d+\])?\s*[:：]\s*)+/i;
  for (let i = 0; i < 10; i++) {
    const next = s.replace(prefix, '').trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

/**
 * In-Reply-To / References ヘッダから Message-ID(<...>)を取り出す。
 * References は空白区切りで複数入る。重複は除き、出現順を保つ。
 * スレッド判定はここで得た ID が mail_messages.message_id に存在するかで行う。
 */
export function extractReferencedMessageIds(
  inReplyTo: string | null | undefined,
  references: string | null | undefined,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const src of [inReplyTo ?? '', references ?? '']) {
    for (const m of src.matchAll(/<[^<>\s]+>/g)) {
      const id = m[0];
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
}

/**
 * Message-ID を正規化する。前後空白を除き、山括弧が無ければ付ける。
 * 空なら <uuid@crm.local> を生成する(NOT NULL UNIQUE を満たすため。
 * ただし生成した ID では Webhook 再送の重複検出はできないので、
 * 呼び出し側は Resend の email_id でも重複を見ること)。
 */
export function ensureMessageId(raw: string | null | undefined): string {
  const s = (raw ?? '').trim();
  if (!s) return `<${randomUUID()}@crm.local>`;
  return s.startsWith('<') ? s : `<${s}>`;
}

/** 宛先群を小文字化したアドレスの集合にする(表示名付き・重複・空を整理) */
function toAddressSet(recipients: Array<string | null | undefined>): Set<string> {
  const set = new Set<string>();
  for (const r of recipients) {
    // "a@x, b@y" のように1ヘッダに複数入ることがあるため分割してから解析する
    for (const part of (r ?? '').split(',')) {
      const a = parseAddress(part).address;
      if (a) set.add(a);
    }
  }
  return set;
}

/**
 * Webhook の宛先(received_for / to)に、運用中の受信用アドレス(MAIL_INBOUND_ADDRESS)が
 * 含まれるか。各サーバーからの転送はすべてこの1アドレスに集まる。
 * 含まれない受信は他所からの流入とみなして無視する(§5.15)。
 */
export function isInboundTarget(
  recipients: Array<string | null | undefined>,
  inboundAddress: string | null | undefined,
): boolean {
  const target = parseAddress(inboundAddress).address;
  if (!target) return false;
  return toAddressSet(recipients).has(target);
}

/**
 * 元の宛先(To / Cc / Delivered-To / X-Original-To / XSRV-Filter)から受信箱を選ぶ。
 * 転送で To は元のまま保持されるため(実メールのヘッダで確認済み)、
 * mail_boxes.address との完全一致(小文字化)で判定する。
 * 一致が無く、有効な受信箱がちょうど1つなら救済としてそれを返す(単一運用で
 * 宛先が書き換わっても取りこぼさない)。複数あって決められないときは null。
 */
export function matchMailBox<T extends { address: string; is_active?: boolean }>(
  boxes: T[],
  recipients: Array<string | null | undefined>,
): T | null {
  const active = boxes.filter((b) => b.is_active !== false);
  const set = toAddressSet(recipients);
  for (const b of active) {
    if (set.has(b.address.trim().toLowerCase())) return b;
  }
  return active.length === 1 ? (active[0] ?? null) : null;
}

/**
 * 添付ファイル名の安全化。Storage のパスに使うため、区切り文字・制御文字を除き、
 * 空なら "attachment" にする。拡張子は保持する。
 */
export function safeFilename(raw: string | null | undefined): string {
  // パス区切り・Windows で使えない記号・制御文字(\p{Cc})を "_" に置き換える
  const s = (raw ?? '')
    .replace(/[\\/:*?"<>|]|\p{Cc}/gu, '_')
    .replace(/^\.+/, '')
    .trim();
  return s || 'attachment';
}

/** 受信を拒否する添付の拡張子(実行形式など)。保存せず、メッセージ本文のみ取り込む。 */
const BLOCKED_EXTENSIONS = new Set([
  'exe',
  'bat',
  'cmd',
  'com',
  'scr',
  'pif',
  'msi',
  'js',
  'jse',
  'vbs',
  'vbe',
  'wsf',
  'wsh',
  'ps1',
  'jar',
  'hta',
  'cpl',
  'reg',
  'lnk',
]);

export function isBlockedAttachment(filename: string | null | undefined): boolean {
  const ext = (filename ?? '').split('.').pop()?.toLowerCase() ?? '';
  return BLOCKED_EXTENSIONS.has(ext);
}
