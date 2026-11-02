import { describe, expect, it } from 'vitest';
import {
  paymentExportHref,
  paymentListParams,
  sanitizePaymentFilter,
  summaryUserHref,
} from '../../lib/domain/payment_list';

/**
 * サマリの入金一覧(CLAUDE.md §8.1 `/summary`)の絞り込み。
 * 一覧は「担当者別の合計に数えている申込」と同じものを出す必要がある(合計と一覧の件数が食い違わないように)。
 */
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

describe('paymentListParams', () => {
  const filter = { paymentFrom: '2026-10-01', paymentTo: '2026-10-31', projectId: 'T-000000001' };

  it('入金のある申込だけを、集計と同じ期間・案件、集計の表に出ている担当者で絞る', () => {
    expect(paymentListParams(filter, [U1, U2], undefined)).toEqual({
      paymentOnly: true,
      paymentFrom: '2026-10-01',
      paymentTo: '2026-10-31',
      projectId: 'T-000000001',
      acquirerIds: [U1, U2],
      selectedUserId: null,
    });
  });

  it('ユーザーを選ぶとその人の入金だけ', () => {
    const p = paymentListParams(filter, [U1, U2], U2);
    expect(p.acquirerIds).toEqual([U2]);
    expect(p.selectedUserId).toBe(U2);
  });

  it('集計の表に出ていない人(有効/無効の絞り込みで外れた人・不正な値)は選べず、全員に戻す', () => {
    for (const bad of [OTHER, 'not-a-uuid', '']) {
      const p = paymentListParams(filter, [U1, U2], bad);
      expect(p.acquirerIds).toEqual([U1, U2]);
      expect(p.selectedUserId).toBeNull();
    }
  });

  it('期間・案件が無ければ付けない(全期間・全案件)', () => {
    const p = paymentListParams({ paymentFrom: null, paymentTo: null, projectId: null }, [U1]);
    expect(p.paymentFrom).toBeUndefined();
    expect(p.paymentTo).toBeUndefined();
    expect(p.projectId).toBeUndefined();
  });

  it('集計の表に誰もいなければ担当者は空(一覧も 0 件)', () => {
    expect(paymentListParams(filter, []).acquirerIds).toEqual([]);
  });
});

describe('summaryUserHref', () => {
  const sp = { preset: 'custom', from: '2026-10-01', to: '2026-10-31', project: 'T-1', page: '3' };

  it('今の絞り込みを残したまま、そのユーザーで絞るリンクを作る(続き読みの位置は捨てる)', () => {
    const href = summaryUserHref(sp, U1);
    const q = new URLSearchParams(href.split('?')[1]);
    expect(href.startsWith('/summary?')).toBe(true);
    expect(q.get('user')).toBe(U1);
    expect(q.get('from')).toBe('2026-10-01');
    expect(q.get('project')).toBe('T-1');
    expect(q.has('page')).toBe(false);
  });

  it('選択中のユーザーをもう一度押すと解除(user を外す)', () => {
    const href = summaryUserHref({ ...sp, user: U1 }, U1);
    expect(new URLSearchParams(href.split('?')[1]).has('user')).toBe(false);
  });

  it('null を渡すと解除', () => {
    const href = summaryUserHref({ ...sp, user: U1 }, null);
    expect(new URLSearchParams(href.split('?')[1]).has('user')).toBe(false);
  });
});

describe('paymentExportHref', () => {
  it('画面と同じ絞り込み(期間・案件・有効/無効・ユーザー・並び)を CSV 出力に引き継ぐ', () => {
    const href = paymentExportHref({
      tab: 'payment',
      preset: 'this_month',
      project: 'T-1',
      active: 'active',
      user: U1,
      sort: 'payment_amount',
      dir: 'desc',
      page: '2',
    });
    expect(href.startsWith('/summary/payment/export?')).toBe(true);
    const q = new URLSearchParams(href.split('?')[1]);
    expect(Object.fromEntries(q)).toEqual({
      preset: 'this_month',
      project: 'T-1',
      active: 'active',
      user: U1,
      sort: 'payment_amount',
      dir: 'desc',
    });
  });
});

describe('sanitizePaymentFilter', () => {
  it('入金一覧でなければ何も付けない(申込一覧の続き読みは従来どおり)', () => {
    expect(sanitizePaymentFilter({})).toEqual({});
    expect(sanitizePaymentFilter({ paymentOnly: 'true', acquirerIds: [U1] })).toEqual({});
  });

  it('日付は YYYY-MM-DD、申込獲得者は UUID だけ残す(重複は 1 つに)', () => {
    expect(
      sanitizePaymentFilter({
        paymentOnly: true,
        paymentFrom: '2026-10-01',
        paymentTo: "2026-10-31'; drop",
        acquirerIds: [U1, U1, 'x', 3, U2],
      }),
    ).toEqual({
      paymentOnly: true,
      paymentFrom: '2026-10-01',
      paymentTo: undefined,
      acquirerIds: [U1, U2],
    });
  });

  it('申込獲得者が配列でなければ空(= 0 件。絞り込みが外れて全件にならないように)', () => {
    expect(sanitizePaymentFilter({ paymentOnly: true, acquirerIds: 'all' }).acquirerIds).toEqual(
      [],
    );
  });
});
