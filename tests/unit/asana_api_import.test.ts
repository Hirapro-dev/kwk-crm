import { describe, expect, it } from 'vitest';
import {
  asanaColorToHex,
  asanaTaskToRow,
  commentsFromStories,
} from '../../lib/domain/asana_api_import';

/** Asana API の JSON(CLAUDE.md §5.20 API 取込)を CRM の形に写す純粋関数 */
describe('asanaColorToHex', () => {
  it('Asana の色名を 16 進に。未知・空は既定色', () => {
    expect(asanaColorToHex('light-green')).toBe('#22c55e');
    expect(asanaColorToHex('dark-red')).toBe('#b91c1c');
    expect(asanaColorToHex(null)).toBe('#f97316');
    expect(asanaColorToHex('none')).toBe('#94a3b8');
  });
});

describe('asanaTaskToRow', () => {
  const users = new Map([['taro@example.com', 'u-1']]);
  it('担当はメールで紐付け、セクションはこのプロジェクトの membership から、カスタム項目・タグは extra に', () => {
    const r = asanaTaskToRow(
      {
        gid: '1',
        name: 'A',
        notes: 'memo',
        completed: true,
        completed_at: '2026-04-27T01:02:03.000Z',
        created_at: '2026-04-09T00:00:00.000Z',
        assignee: { gid: 'a', name: '山田', email: 'Taro@Example.com' },
        start_on: null,
        due_on: '2026-09-20',
        parent: { gid: '9' },
        memberships: [
          { project: { gid: 'p2' }, section: { gid: 's-other' } },
          { project: { gid: 'p1' }, section: { gid: 's1' } },
        ],
        tags: [{ name: 't1' }],
        custom_fields: [
          { name: '優先度', display_value: '高' },
          { name: '空', display_value: null },
        ],
        permalink_url: 'https://app.asana.com/0/1/1',
      },
      'p1',
      users,
    );
    expect(r).toMatchObject({
      asana_gid: '1',
      name: 'A',
      notes: 'memo',
      assignee_id: 'u-1',
      assignee_name_raw: '山田',
      due_date: '2026-09-20',
      start_date: null,
      completed_at: '2026-04-27T01:02:03.000Z',
      asana_created_at: '2026-04-09T00:00:00.000Z',
      parent_gid: '9',
      section_gid: 's1',
    });
    expect(r.extra).toEqual({
      tags: ['t1'],
      custom_fields: { 優先度: '高' },
      asana_url: 'https://app.asana.com/0/1/1',
    });
  });
  it('未完了は completed_at null。担当なし・membership なしも扱える', () => {
    const r = asanaTaskToRow(
      { gid: '2', name: 'B', completed: false, completed_at: null, memberships: [] },
      'p1',
      users,
    );
    expect(r.completed_at).toBeNull();
    expect(r.assignee_id).toBeNull();
    expect(r.section_gid).toBeNull();
    expect(r.extra).toEqual({});
  });
});

describe('commentsFromStories', () => {
  it('type=comment の story だけをコメントにし、投稿者はメールで CRM ユーザーに合わせる', () => {
    const users = new Map([['taro@example.com', 'u-1']]);
    const out = commentsFromStories(
      [
        {
          gid: 's1',
          type: 'comment',
          text: 'こんにちは',
          created_at: '2026-01-01T00:00:00.000Z',
          created_by: { name: '山田', email: 'taro@example.com' },
        },
        {
          gid: 's2',
          type: 'system',
          text: 'added to project',
          created_at: '2026-01-01T00:00:00.000Z',
          created_by: { name: 'x', email: null },
        },
        {
          gid: 's3',
          type: 'comment',
          text: '',
          created_at: '2026-01-02T00:00:00.000Z',
          created_by: null,
        },
      ],
      users,
    );
    expect(out).toEqual([
      {
        asana_gid: 's1',
        body: 'こんにちは',
        created_at: '2026-01-01T00:00:00.000Z',
        user_id: 'u-1',
        author_name_raw: '山田',
      },
    ]);
  });
});
