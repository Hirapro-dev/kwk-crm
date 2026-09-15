import { describe, expect, it } from 'vitest';
import { matchMailBox } from '../../lib/domain/mail_inbound';

/**
 * 受信箱の特定(CLAUDE.md §5.15)。元の宛先(To / Cc / 転送で付くヘッダ)と mail_boxes.address の一致。
 * 同じメールが複数の共有アドレスを経由して届くことがあるため、受信箱の並び(id 順)ではなく
 * 「宛先の並び(To → Cc → 転送ヘッダ)」で最初に一致した受信箱を選ぶ(2026-09-15)。
 * そうしないと、To が quest@ のメールでも、転送経路の application@ の方が id が小さいだけで
 * application@ の受信箱に入ってしまう(同じメールの2通目の通知は quest@ に入り、スレッドが割れる)。
 */
describe('matchMailBox', () => {
  const boxes = [
    { id: 39, address: 'application@toushi-kawaraban.com', is_active: true },
    { id: 60, address: 'quest@kawaraban.co.jp', is_active: true },
    { id: 70, address: 'off@example.com', is_active: false },
  ];

  it('宛先の並び順で最初に一致した受信箱を選ぶ(受信箱の id 順ではない)', () => {
    const box = matchMailBox(boxes, [
      'quest@kawaraban.co.jp', // To
      'y3awtd-hirayama-p@hdbronze.htdb.jp', // To(判定アドレス。受信箱ではない)
      'application@toushi-kawaraban.com', // Delivered-To(転送経路)
    ]);
    expect(box?.id).toBe(60);
  });

  it('To に受信箱が無ければ、後ろの宛先(Cc・転送ヘッダ)で一致した受信箱を選ぶ', () => {
    expect(
      matchMailBox(boxes, ['someone@example.com', null, 'application@toushi-kawaraban.com'])?.id,
    ).toBe(39);
  });

  it('1つのヘッダに複数アドレスがあっても分割して判定し、大文字小文字は無視する', () => {
    expect(matchMailBox(boxes, ['"A" <x@example.com>, Quest@Kawaraban.co.jp'])?.id).toBe(60);
  });

  it('無効な受信箱は選ばない。一致が無く有効な受信箱が1つだけならそれを選ぶ', () => {
    expect(matchMailBox(boxes, ['off@example.com'])).toBeNull();
    expect(matchMailBox(boxes.slice(1, 2), ['nobody@example.com'])?.id).toBe(60);
    expect(matchMailBox(boxes, ['nobody@example.com'])).toBeNull();
  });
});
