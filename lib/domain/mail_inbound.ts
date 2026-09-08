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

/**
 * 受信メールの宛先群が、いずれかの受信箱の inbound_address に一致するか。
 * Xserver からの転送では宛先は元の ad@kawaraban.co.jp のままで、Resend 側は
 * `received_for`(実際に配送された受信アドレス)に inbox@...resend.app を入れてくるため、
 * to と received_for の両方を見る。一致しない受信は無視する(§5.15)。
 */
export function findInboundBox<T extends { inbound_address: string | null }>(
  boxes: T[],
  recipients: Array<string | null | undefined>,
): T | null {
  const set = new Set(
    recipients.map((r) => parseAddress(r).address).filter((a): a is string => a !== ''),
  );
  for (const b of boxes) {
    const ia = (b.inbound_address ?? '').trim().toLowerCase();
    if (ia && set.has(ia)) return b;
  }
  return null;
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
