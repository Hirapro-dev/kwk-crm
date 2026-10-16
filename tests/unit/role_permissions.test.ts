/**
 * ロールの権限表(ユーザー一覧に表示)。
 * 意図: 表は説明用だが、実際の判定関数がある権限(メールの送信承認)とは食い違わないようにする。
 *       すべての行が 5 ロール分の印を持ち、閲覧ロール(viewer)は書き込み系の操作ができない表示になっている。
 */
import { canApproveOutbox } from '@/lib/domain/mail_outbox';
import { PERMISSION_ROLES, ROLE_PERMISSION_TABLE } from '@/lib/domain/role_permissions';
import { describe, expect, it } from 'vitest';

const rows = ROLE_PERMISSION_TABLE.flatMap((s) => s.rows.map((r) => ({ ...r, area: s.area })));

describe('ROLE_PERMISSION_TABLE', () => {
  it('CRM・メーラー・タスク管理の 3 区分がある', () => {
    expect(ROLE_PERMISSION_TABLE.map((s) => s.area)).toEqual(['CRM', 'メーラー', 'タスク管理']);
  });

  it('すべての行が 5 ロールすべての印を持つ', () => {
    for (const r of rows) {
      for (const role of PERMISSION_ROLES) expect(['○', '△', '×']).toContain(r.marks[role]);
    }
  });

  it('△(条件付き)のある行には条件の備考がある', () => {
    for (const r of rows) {
      if (Object.values(r.marks).includes('△')) expect(r.note, r.action).toBeTruthy();
    }
  });

  it('送信の承認は、判定関数(canApproveOutbox)で承認できるロールだけが ○', () => {
    const row = rows.find((r) => r.action === '送信の承認・差し戻し');
    expect(row).toBeDefined();
    for (const role of ['admin', 'manager', 'sales', 'viewer'] as const) {
      const can = canApproveOutbox({ id: 'me', role }, { status: 'pending', created_by: 'other' });
      expect(row?.marks[role]).toBe(can ? '○' : '×');
    }
  });

  it('閲覧ロールは「閲覧」以外の操作が × 、ただしタスクの閲覧は条件付き', () => {
    for (const r of rows) {
      if (r.action.includes('閲覧') && !r.action.includes('出金') && !r.action.includes('旧社債')) {
        expect(r.marks.viewer).not.toBe('×');
      } else if (!r.action.includes('閲覧')) {
        expect(r.marks.viewer, r.action).toBe('×');
      }
    }
  });
});
