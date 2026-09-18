import { describe, expect, it } from 'vitest';
import { asanaCsvRowToTask, resolveParentGids } from '../../lib/domain/asana_import';

function must<T>(v: T | null): T {
  if (v === null) throw new Error('null');
  return v;
}

/**
 * Asana の CSV エクスポート(CLAUDE.md §5.20)を CRM のタスクに写す純粋関数。
 * 列: Task ID / Created At / Completed At / Name / Section/Column / Assignee / Assignee Email / Start Date / Due Date / Tags / Notes /
 *     Projects / Parent task / Blocked By / Blocking。
 */
const row = (over: Record<string, string> = {}) => ({
  'Task ID': '1200000000000001',
  'Created At': '2026-04-09',
  'Completed At': '',
  'Last Modified': '2026-09-18',
  Name: '見積書を送る',
  'Section/Column': '報告書',
  Assignee: '山田 太郎',
  'Assignee Email': 'Taro@Example.com',
  'Start Date': '',
  'Due Date': '2026-09-20',
  Tags: 'a, b',
  Notes: '本文',
  Projects: 'サポートデスク',
  'Parent task': '',
  'Blocked By (Dependencies)': '',
  'Blocking (Dependencies)': '',
  ...over,
});

describe('asanaCsvRowToTask', () => {
  it('列を CRM の項目に写し、担当はメール(小文字)で CRM ユーザーに合わせる。一致しなければ名前を原文で残す', () => {
    const users = new Map([['taro@example.com', 'u-1']]);
    const t = must(asanaCsvRowToTask(row(), users));
    expect(t).toMatchObject({
      asana_gid: '1200000000000001',
      name: '見積書を送る',
      notes: '本文',
      section_name: '報告書',
      assignee_id: 'u-1',
      assignee_name_raw: '山田 太郎',
      due_date: '2026-09-20',
      start_date: null,
      completed_at: null,
      asana_created_at: '2026-04-09T00:00:00+09:00',
      project_name: 'サポートデスク',
      parent_task_name: null,
    });
    expect(t.extra).toEqual({ tags: ['a', 'b'] });
    const t2 = must(asanaCsvRowToTask(row({ 'Assignee Email': 'x@example.com' }), users));
    expect(t2.assignee_id).toBeNull();
    expect(t2.assignee_name_raw).toBe('山田 太郎');
  });
  it('完了日は日本時間の日付として、Parent task は名前で保持する。空のセクションは null', () => {
    const t = must(
      asanaCsvRowToTask(
        row({
          'Completed At': '2026-04-27',
          'Parent task': '親の名前',
          'Section/Column': '',
          Tags: '',
          Notes: '',
        }),
        new Map(),
      ),
    );
    expect(t.completed_at).toBe('2026-04-27T00:00:00+09:00');
    expect(t.parent_task_name).toBe('親の名前');
    expect(t.section_name).toBeNull();
    expect(t.notes).toBeNull();
    expect(t.extra).toEqual({});
  });
  it('Task ID か Name が無い行は null(取り込まない)', () => {
    expect(asanaCsvRowToTask(row({ 'Task ID': '' }), new Map())).toBeNull();
    expect(asanaCsvRowToTask(row({ Name: '  ' }), new Map())).toBeNull();
  });
});

describe('resolveParentGids', () => {
  it('親タスク名が同じプロジェクト内で一意に決まるときだけ紐付ける(同名が複数・無しは null)', () => {
    const tasks = [
      { asana_gid: '1', name: '親A', parent_task_name: null },
      { asana_gid: '2', name: '親B', parent_task_name: null },
      { asana_gid: '3', name: '親B', parent_task_name: null },
      { asana_gid: '4', name: '子1', parent_task_name: '親A' },
      { asana_gid: '5', name: '子2', parent_task_name: '親B' },
      { asana_gid: '6', name: '子3', parent_task_name: '存在しない' },
    ];
    expect(resolveParentGids(tasks)).toEqual(
      new Map([
        ['4', '1'],
        ['5', null],
        ['6', null],
      ]),
    );
  });
});
