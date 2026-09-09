import { describe, expect, it } from 'vitest';
import {
  domainOfAddress,
  groupMailBoxesByDomain,
  sumMailBoxCounts,
} from '../../lib/domain/mail_folders';
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
