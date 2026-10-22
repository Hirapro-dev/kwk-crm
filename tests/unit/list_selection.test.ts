/**
 * 一覧のチェックの範囲選択(Shift を押しながらチェック。2026-10-22 ユーザー要望)。
 * 意図: Gmail などと同じく、前回チェックした行から今回の行までをまとめて、今回の行と同じ状態(選択 / 解除)にする。
 *       前回の行が画面から消えた(削除・読み直し)ときは、今回の行だけを切り替える。
 */
import { applyRowSelection } from '@/lib/domain/list_selection';
import { describe, expect, it } from 'vitest';

const ids = ['a', 'b', 'c', 'd', 'e'];
const set = (...xs: string[]) => new Set(xs);

describe('applyRowSelection', () => {
  it('Shift なしは今回の行だけを切り替える', () => {
    expect([...applyRowSelection(ids, set(), 'b', { shift: false, anchorId: null })]).toEqual([
      'b',
    ]);
    expect([...applyRowSelection(ids, set('b'), 'b', { shift: false, anchorId: 'a' })]).toEqual([]);
  });
  it('Shift ありは前回の行から今回の行までをまとめて選ぶ(下向き・上向きどちらも)', () => {
    expect(
      [...applyRowSelection(ids, set('b'), 'd', { shift: true, anchorId: 'b' })].sort(),
    ).toEqual(['b', 'c', 'd']);
    expect(
      [...applyRowSelection(ids, set('d'), 'b', { shift: true, anchorId: 'd' })].sort(),
    ).toEqual(['b', 'c', 'd']);
  });
  it('今回の行が選択済みなら、範囲をまとめて解除する', () => {
    const r = applyRowSelection(ids, set('a', 'b', 'c', 'd', 'e'), 'd', {
      shift: true,
      anchorId: 'b',
    });
    expect([...r].sort()).toEqual(['a', 'e']);
  });
  it('範囲の外の選択はそのまま残す', () => {
    const r = applyRowSelection(ids, set('a', 'e'), 'd', { shift: true, anchorId: 'c' });
    expect([...r].sort()).toEqual(['a', 'c', 'd', 'e']);
  });
  it('前回の行が無い・画面に無いときは今回の行だけ', () => {
    expect([...applyRowSelection(ids, set(), 'c', { shift: true, anchorId: null })]).toEqual(['c']);
    expect([...applyRowSelection(ids, set(), 'c', { shift: true, anchorId: 'zz' })]).toEqual(['c']);
  });
  it('元の選択(Set)は書き換えない', () => {
    const before = set('a');
    applyRowSelection(ids, before, 'c', { shift: true, anchorId: 'a' });
    expect([...before]).toEqual(['a']);
  });
});
