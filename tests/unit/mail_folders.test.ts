import { describe, expect, it } from 'vitest';
import {
  domainOfAddress,
  expandedDomainForBox,
  groupMailBoxesByDomain,
  pinnedFolderItems,
  splitOtherMailBox,
  sumMailBoxCounts,
} from '../../lib/domain/mail_folders';
import { OTHER_MAILBOX_ADDRESS } from '../../lib/domain/mail_types';
import type { MailBox } from '../../lib/domain/mail_types';

/**
 * メーラー左ペインのフォルダ組み立て(CLAUDE.md §5.15)。
 * 受信箱が数百件になる前提なので、ドメインごとのまとまりと並び順が
 * 毎回同じ(決定論的)であることをテストで固定する。
 */

const box = (id: number, address: string, is_active = true): MailBox => ({
  id,
  address,
  display_name: null,
  signature: null,
  is_active,
});

describe('domainOfAddress', () => {
  it('@ 以降を小文字で返す', () => {
    expect(domainOfAddress('Info@Kawaraban.co.jp')).toBe('kawaraban.co.jp');
  });
  it('@ が無ければ空文字', () => {
    expect(domainOfAddress('broken')).toBe('');
  });
});

describe('groupMailBoxesByDomain', () => {
  it('ドメインごとにまとめ、ドメイン・アドレスとも昇順に並べる', () => {
    const groups = groupMailBoxesByDomain([
      box(3, 'info@hirapro.jp'),
      box(1, 'entry@kawaraban.co.jp'),
      box(2, 'ad@kawaraban.co.jp'),
    ]);
    expect(groups.map((g) => g.domain)).toEqual(['hirapro.jp', 'kawaraban.co.jp']);
    expect(groups[1]?.items.map((i) => i.localPart)).toEqual(['ad', 'entry']);
  });

  it('件数を受信箱ごとに割り当て、グループ合計も出す', () => {
    const groups = groupMailBoxesByDomain(
      [box(1, 'ad@kawaraban.co.jp'), box(2, 'entry@kawaraban.co.jp')],
      [
        { mail_box_id: 1, pending_count: 3, unread_count: 2 },
        { mail_box_id: 2, pending_count: 5, unread_count: 0 },
      ],
    );
    expect(groups[0]?.pendingCount).toBe(8);
    expect(groups[0]?.unreadCount).toBe(2);
    expect(groups[0]?.items.find((i) => i.id === 2)?.pendingCount).toBe(5);
  });

  it('件数が無い受信箱は 0 件として扱う(migration 77 未適用でも壊れない)', () => {
    const groups = groupMailBoxesByDomain([box(1, 'ad@kawaraban.co.jp')]);
    expect(groups[0]?.items[0]?.pendingCount).toBe(0);
    expect(groups[0]?.items[0]?.unreadCount).toBe(0);
  });

  it('無効な受信箱も一覧には残す(過去メールの参照用)', () => {
    const groups = groupMailBoxesByDomain([box(1, 'old@kawaraban.co.jp', false)]);
    expect(groups[0]?.items[0]?.isActive).toBe(false);
  });
});

describe('sumMailBoxCounts', () => {
  it('全受信箱の合計を返す', () => {
    expect(
      sumMailBoxCounts([
        { mail_box_id: 1, pending_count: 1, unread_count: 1 },
        { mail_box_id: 2, pending_count: 2, unread_count: 0 },
      ]),
    ).toEqual({ pendingCount: 3, unreadCount: 1 });
  });
});

describe('splitOtherMailBox(未登録アドレス宛の「その他」を切り離す。migration 78)', () => {
  it('予約アドレスの行を other として切り出し、残りを rest に返す', () => {
    const other = box(99, OTHER_MAILBOX_ADDRESS);
    const real = box(1, 'ad@kawaraban.co.jp');
    const { other: found, rest } = splitOtherMailBox([real, other]);
    expect(found?.id).toBe(99);
    expect(rest).toEqual([real]);
  });

  it('「その他」が未登録(migration 78 未適用)なら other は null、rest はそのまま', () => {
    const real = box(1, 'ad@kawaraban.co.jp');
    const { other, rest } = splitOtherMailBox([real]);
    expect(other).toBeNull();
    expect(rest).toEqual([real]);
  });
});

/**
 * 左フォルダの初期開閉状態(2026-09-14)。受信箱が数百件になったため、既定では
 * 全ドメインを閉じた状態にする。ただし選択中の受信箱があるドメインだけは開いておく
 * (選択中のフォルダが隠れて見えないと、どこを見ているのか分からなくなるため)。
 */
describe('expandedDomainForBox', () => {
  const groups = groupMailBoxesByDomain([
    box(1, 'info@a.example'),
    box(2, 'sales@a.example'),
    box(3, 'info@b.example'),
  ]);

  it('選択中の受信箱があるドメインを返す', () => {
    expect(expandedDomainForBox(groups, 3)).toBe('b.example');
  });

  it('受信箱が未選択(null)なら null(=すべて閉じる)', () => {
    expect(expandedDomainForBox(groups, null)).toBeNull();
  });

  it('どのグループにも無い受信箱IDなら null', () => {
    expect(expandedDomainForBox(groups, 999)).toBeNull();
  });
});

/**
 * ユーザーごとの受信箱ピン留め(2026-09-14, migration 84)。
 * 左フォルダ上部の「ピン留め」区画に、ピン留めした順で受信箱を並べる。
 */
describe('pinnedFolderItems', () => {
  const groups = groupMailBoxesByDomain(
    [box(1, 'info@a.example'), box(2, 'sales@a.example'), box(3, 'info@b.example')],
    [{ mail_box_id: 3, pending_count: 4, unread_count: 1 }],
  );

  it('ピン留めした順に受信箱を返し、件数も引き継ぐ', () => {
    const items = pinnedFolderItems(groups, [3, 1]);
    expect(items.map((i) => i.address)).toEqual(['info@b.example', 'info@a.example']);
    expect(items[0]?.pendingCount).toBe(4);
  });

  it('存在しない受信箱IDは無視し、重複は1件にする', () => {
    expect(pinnedFolderItems(groups, [9, 2, 2]).map((i) => i.id)).toEqual([2]);
  });

  it('ピン留めが無ければ空', () => {
    expect(pinnedFolderItems(groups, [])).toEqual([]);
  });
});
