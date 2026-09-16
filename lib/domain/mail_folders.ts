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

/**
 * 左フォルダの初期表示で開いておくドメイン(選択中の受信箱があるドメイン)。
 * 受信箱が数百件あるため既定では全ドメインを閉じるが、選択中の受信箱のフォルダが
 * 隠れて見えないと現在地が分からなくなるので、そのドメインだけ開く。
 * 受信箱が未選択、またはどのグループにも無い ID なら null(=すべて閉じる)。
 */
export function expandedDomainForBox(
  groups: readonly MailFolderGroup[],
  selectedBoxId: number | null,
): string | null {
  if (selectedBoxId === null || !Number.isFinite(selectedBoxId)) return null;
  const g = groups.find((grp) => grp.items.some((b) => b.id === selectedBoxId));
  return g ? g.domain : null;
}

/**
 * 左フォルダ上部の「ピン留め」区画(migration 84)。自分がピン留めした受信箱を、
 * ピン留めした順(pinnedBoxIds の順)で、件数付きの MailFolderItem として返す。
 * 存在しない ID は無視し、重複は1件にする。
 */
export function pinnedFolderItems(
  groups: readonly MailFolderGroup[],
  pinnedBoxIds: readonly number[],
): MailFolderItem[] {
  const byId = new Map<number, MailFolderItem>();
  for (const g of groups) for (const item of g.items) byId.set(item.id, item);
  const out: MailFolderItem[] = [];
  const seen = new Set<number>();
  for (const id of pinnedBoxIds) {
    if (seen.has(id)) continue;
    const item = byId.get(id);
    if (!item) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
}

/** マイフォルダ(migration 92)の1件。boxIds は表示順 */
export interface MailUserFolder {
  id: number;
  name: string;
  boxIds: number[];
}

export interface MailUserFolderSection {
  id: number;
  name: string;
  items: MailFolderItem[];
  pendingCount: number;
  unreadCount: number;
}

/**
 * 左フォルダの「マイフォルダ」区画(migration 92)。自分のフォルダごとに、登録した順の受信箱を
 * 件数付きの MailFolderItem として返す。存在しない ID は無視し、重複は1件にする。
 */
export function userFolderSections(
  groups: readonly MailFolderGroup[],
  folders: readonly MailUserFolder[],
): MailUserFolderSection[] {
  return folders.map((f) => {
    const items = pinnedFolderItems(groups, f.boxIds);
    return {
      id: f.id,
      name: f.name,
      items,
      pendingCount: items.reduce((n, i) => n + i.pendingCount, 0),
      unreadCount: items.reduce((n, i) => n + i.unreadCount, 0),
    };
  });
}

/**
 * フォルダ内の並び替え(ドラッグ&ドロップ)。movedId を beforeId の前に差し込んだ並びを返す。
 * beforeId が null なら末尾。movedId が一覧に無ければ(別フォルダからの移動)追加する。
 * 自分自身の前に置く、または beforeId が一覧に無いときは並びを変えない。
 */
export function moveBoxInList(
  ids: readonly number[],
  movedId: number,
  beforeId: number | null,
): number[] {
  if (beforeId !== null && (beforeId === movedId || !ids.includes(beforeId))) return [...ids];
  const rest = ids.filter((id) => id !== movedId);
  if (beforeId === null) return [...rest, movedId];
  const idx = rest.indexOf(beforeId);
  return [...rest.slice(0, idx), movedId, ...rest.slice(idx)];
}

/**
 * 返信・新規作成の「送信元」「署名」プルダウン用: アドレスを持つ項目をドメインごとにまとめる
 * (optgroup のセクション)。ドメイン・アドレスとも昇順(決定論的)。ドメインの大小文字は同一視する。
 */
export function groupAddressesByDomain<T extends { address: string }>(
  items: readonly T[],
): Array<{ domain: string; items: T[] }> {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const d = domainOfAddress(it.address);
    const list = groups.get(d) ?? [];
    list.push(it);
    groups.set(d, list);
  }
  const out = [...groups.entries()].map(([domain, list]) => ({
    domain,
    items: [...list].sort((a, b) => a.address.localeCompare(b.address)),
  }));
  out.sort((a, b) => a.domain.localeCompare(b.domain));
  return out;
}
