/**
 * メーラー画面の「フォルダ」(左ペイン)の組み立て(CLAUDE.md §5.15 / §8.1)。
 *
 * 受信箱(mail_boxes)をドメインごとにまとめ、メールディーラーの
 * 「会社/ブランド > アドレス」に相当する階層を作る。純粋関数のみで
 * サーバー依存を持たない(クライアント部品からも import できる)。
 */

import { type MailBox, OTHER_MAILBOX_ADDRESS } from './mail_types';

/** 受信箱ごとの件数(migration 77 の mail_box_counts() の戻り値) */
export interface MailBoxCount {
  mail_box_id: number;
  /** 未対応のスレッド数(通常分類のみ) */
  pending_count: number;
  /** 未読のスレッド数(通常分類のみ) */
  unread_count: number;
}

export interface MailFolderItem {
  id: number;
  address: string;
  /** アドレスの @ より前(フォルダ名として表示) */
  localPart: string;
  displayName: string | null;
  isActive: boolean;
  pendingCount: number;
  unreadCount: number;
}

export interface MailFolderGroup {
  /** ドメイン(例: kawaraban.co.jp) */
  domain: string;
  items: MailFolderItem[];
  /** グループ内の未対応件数の合計 */
  pendingCount: number;
  unreadCount: number;
}

/** アドレスの @ 以降(小文字)。@ が無ければ空文字 */
export function domainOfAddress(address: string): string {
  const i = address.indexOf('@');
  return i >= 0 ? address.slice(i + 1).toLowerCase() : '';
}

/**
 * 受信箱をドメインごとにグループ化する。
 * - グループはドメイン名の昇順、グループ内はアドレスの昇順(決定論的)
 * - 無効な受信箱(is_active=false)も表示はする(過去メールの参照用)が、件数は 0 扱いにしない
 *   (件数は DB 側の集計をそのまま出す)
 */
export function groupMailBoxesByDomain(
  boxes: readonly MailBox[],
  counts: readonly MailBoxCount[] = [],
): MailFolderGroup[] {
  const countMap = new Map<number, MailBoxCount>();
  for (const c of counts) countMap.set(c.mail_box_id, c);

  const groups = new Map<string, MailFolderGroup>();
  for (const b of boxes) {
    const domain = domainOfAddress(b.address);
    const c = countMap.get(b.id);
    const item: MailFolderItem = {
      id: b.id,
      address: b.address,
      localPart: b.address.split('@')[0] ?? b.address,
      displayName: b.display_name,
      isActive: b.is_active,
      pendingCount: Number(c?.pending_count ?? 0),
      unreadCount: Number(c?.unread_count ?? 0),
    };
    const g = groups.get(domain) ?? { domain, items: [], pendingCount: 0, unreadCount: 0 };
    g.items.push(item);
    g.pendingCount += item.pendingCount;
    g.unreadCount += item.unreadCount;
    groups.set(domain, g);
  }

  const out = [...groups.values()];
  for (const g of out) g.items.sort((a, b) => a.address.localeCompare(b.address));
  out.sort((a, b) => a.domain.localeCompare(b.domain));
  return out;
}

/**
 * 「その他」(未登録アドレス宛。migration 78)を通常の受信箱一覧から切り離す。
 * サイドバーではドメイン階層に混ぜず、独立した固定項目として表示する。
 */
export function splitOtherMailBox(boxes: readonly MailBox[]): {
  other: MailBox | null;
  rest: MailBox[];
} {
  const other = boxes.find((b) => b.address === OTHER_MAILBOX_ADDRESS) ?? null;
  const rest = boxes.filter((b) => b.address !== OTHER_MAILBOX_ADDRESS);
  return { other, rest };
}

/** 全受信箱の合計(左ペイン先頭の「すべて」用) */
export function sumMailBoxCounts(counts: readonly MailBoxCount[]): {
  pendingCount: number;
  unreadCount: number;
} {
  let pendingCount = 0;
  let unreadCount = 0;
  for (const c of counts) {
    pendingCount += Number(c.pending_count ?? 0);
    unreadCount += Number(c.unread_count ?? 0);
  }
  return { pendingCount, unreadCount };
}
