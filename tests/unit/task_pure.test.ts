import { describe, expect, it } from 'vitest';
import {
  dueTone,
  groupMyTasksByDue,
  groupTasksBySection,
  nextSortOrder,
  sortMyTasks,
  splitLinks,
  storageSafeName,
} from '../../lib/domain/task_pure';

/**
 * タスク管理(CLAUDE.md §5.20)の表示ロジック。並び・グループ分け・期日の見せ方を純粋関数に置く。
 */
const t = (over: Record<string, unknown>) => ({
  id: 1,
  section_id: null,
  sort_order: 100,
  due_date: null,
  completed_at: null,
  created_at: '2026-09-01T00:00:00Z',
  ...over,
});

describe('groupTasksBySection', () => {
  it('セクションの並び順どおりにまとめ、セクション無しのタスクは先頭の「(セクションなし)」に入れる。セクション内は sort_order 順', () => {
    const sections = [
      { id: 2, name: '報告書', sort_order: 20 },
      { id: 1, name: '議事録', sort_order: 10 },
    ];
    const tasks = [
      t({ id: 1, section_id: 2, sort_order: 200 }),
      t({ id: 2, section_id: 2, sort_order: 100 }),
      t({ id: 3, section_id: null }),
      t({ id: 4, section_id: 1 }),
      t({ id: 5, section_id: 99 }), // 消えたセクション → セクションなし扱い
    ];
    const g = groupTasksBySection(sections, tasks);
    expect(g.map((x) => x.section?.name ?? null)).toEqual([null, '議事録', '報告書']);
    expect(g[0]?.tasks.map((x) => x.id)).toEqual([3, 5]);
    expect(g[2]?.tasks.map((x) => x.id)).toEqual([2, 1]);
  });
  it('セクション無しのタスクが無ければ「(セクションなし)」は出さない。空のセクションは残す(追加先として)', () => {
    const g = groupTasksBySection(
      [{ id: 1, name: 'A', sort_order: 1 }],
      [t({ id: 1, section_id: 1 })],
    );
    expect(g.length).toBe(1);
    expect(g[0]?.section?.id).toBe(1);
    const g2 = groupTasksBySection([{ id: 1, name: 'A', sort_order: 1 }], []);
    expect(g2.length).toBe(1);
    expect(g2[0]?.tasks).toEqual([]);
  });
});

describe('sortMyTasks', () => {
  it('期日あり(近い順)→ 期日なし(作成が古い順)。同じ期日は作成順', () => {
    const list = [
      t({ id: 1, due_date: null, created_at: '2026-09-02T00:00:00Z' }),
      t({ id: 2, due_date: '2026-09-20' }),
      t({ id: 3, due_date: '2026-09-10', created_at: '2026-09-03T00:00:00Z' }),
      t({ id: 4, due_date: '2026-09-10', created_at: '2026-09-01T00:00:00Z' }),
      t({ id: 5, due_date: null, created_at: '2026-09-01T00:00:00Z' }),
    ];
    expect(sortMyTasks(list).map((x) => x.id)).toEqual([4, 3, 2, 5, 1]);
  });
});

describe('dueTone', () => {
  it('期限切れ=overdue、今日=today、7日以内=soon、それ以外=normal、期日なし=none。完了済みは常に done', () => {
    const today = '2026-09-18';
    expect(dueTone('2026-09-17', null, today)).toBe('overdue');
    expect(dueTone('2026-09-18', null, today)).toBe('today');
    expect(dueTone('2026-09-25', null, today)).toBe('soon');
    expect(dueTone('2026-09-26', null, today)).toBe('normal');
    expect(dueTone(null, null, today)).toBe('none');
    expect(dueTone('2026-09-17', '2026-09-18T00:00:00Z', today)).toBe('done');
  });
});

describe('nextSortOrder', () => {
  it('末尾に足すときは最大値 + 100、空なら 100', () => {
    expect(nextSortOrder([])).toBe(100);
    expect(nextSortOrder([t({ sort_order: 100 }), t({ sort_order: 250 })])).toBe(350);
  });
});

describe('groupMyTasksByDue', () => {
  it('Asana のマイタスクのように 期限切れ / 今日 / 今後 7 日 / それ以降 / 期日なし に分け、空のグループは出さない', () => {
    const today = '2026-09-18';
    const list = [
      t({ id: 1, due_date: '2026-09-10' }),
      t({ id: 2, due_date: '2026-09-18' }),
      t({ id: 3, due_date: '2026-09-25' }),
      t({ id: 4, due_date: '2026-10-30' }),
      t({ id: 5, due_date: null }),
      t({ id: 6, due_date: '2026-09-01' }),
    ];
    const g = groupMyTasksByDue(list, today);
    expect(g.map((x) => [x.label, x.tasks.map((y) => y.id)])).toEqual([
      ['期限切れ', [6, 1]],
      ['今日', [2]],
      ['今後 7 日', [3]],
      ['それ以降', [4]],
      ['期日なし', [5]],
    ]);
    expect(groupMyTasksByDue([t({ id: 9, due_date: null })], today).map((x) => x.label)).toEqual([
      '期日なし',
    ]);
  });
});

describe('splitLinks', () => {
  it('URL だけをリンク断片にし、前後の本文は残す', () => {
    expect(
      splitLinks('＊LP原稿\nhttps://docs.google.com/document/d/abc/edit?usp=sharing\n===='),
    ).toEqual([
      { kind: 'text', value: '＊LP原稿\n' },
      { kind: 'link', value: 'https://docs.google.com/document/d/abc/edit?usp=sharing' },
      { kind: 'text', value: '\n====' },
    ]);
  });
  it('末尾の句読点・閉じ括弧・全角括弧は URL に含めない', () => {
    expect(splitLinks('参照(https://example.com/a)。次')).toEqual([
      { kind: 'text', value: '参照(' },
      { kind: 'link', value: 'https://example.com/a' },
      { kind: 'text', value: ')。次' },
    ]);
    expect(splitLinks('（https://example.com/b）')).toEqual([
      { kind: 'text', value: '（' },
      { kind: 'link', value: 'https://example.com/b' },
      { kind: 'text', value: '）' },
    ]);
  });
  it('URL が無ければ本文 1 断片。空文字は空配列', () => {
    expect(splitLinks('リンクなし')).toEqual([{ kind: 'text', value: 'リンクなし' }]);
    expect(splitLinks('')).toEqual([]);
describe('storageSafeName', () => {
  it('日本語・全角記号・特殊な空白を "_" にし、拡張子は残す(Storage は ASCII のキーしか受け付けない)', () => {
    expect(storageSafeName('スクリーンショット 2026-03-18 14.29.32.png')).toBe(
      '2026-03-18_14.29.32.png',
    );
    expect(storageSafeName('見積書（脱炭素マーケティング様）2023年32名様.pdf')).toBe('2023_32.pdf');
    expect(storageSafeName('MainVisual２.png')).toBe('MainVisual.png');
  });
  it('英数字だけの名前はそのまま。空になったら file、長すぎれば 120 文字に収める', () => {
    expect(storageSafeName('report_v2-final.PDF')).toBe('report_v2-final.pdf');
    expect(storageSafeName('日本語')).toBe('file');
    expect(storageSafeName(`${'a'.repeat(200)}.png`).length).toBe(120);
  });
});
