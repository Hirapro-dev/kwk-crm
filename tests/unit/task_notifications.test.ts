import { buildNotificationEmailText, buildTaskNotification } from '@/lib/domain/task_notifications';
import { describe, expect, it } from 'vitest';

/** タスク通知の文面(CLAUDE.md §5.20 migration 116)。誰が・何を・どこを開くかが崩れないことを固定する */
describe('buildTaskNotification', () => {
  it('割当: 誰が割り当てたかとタスク名(プロジェクト付き)、開く先は /task/[id]', () => {
    const p = buildTaskNotification('assigned', {
      taskId: 12,
      taskName: '請求書の送付',
      actorName: '山田 太郎',
      projectName: '総務',
    });
    expect(p.title).toBe('山田 太郎 さんがあなたにタスクを割り当てました');
    expect(p.body).toBe('請求書の送付(総務)');
    expect(p.url).toBe('/task/12');
    expect(p.tag).toBe('task-12-assigned');
  });
  it('メンション: 名前が無ければ「誰か」、プロジェクト無しなら括弧なし', () => {
    const p = buildTaskNotification('mentioned', { taskId: 3, taskName: 'A', actorName: null });
    expect(p.title).toBe('誰か さんがコメントであなたを呼びました');
    expect(p.body).toBe('A');
  });
  it('メール本文は絶対 URL を含む(末尾スラッシュは重ねない)', () => {
    const p = buildTaskNotification('mentioned', { taskId: 3, taskName: 'A', actorName: 'X' });
    expect(buildNotificationEmailText(p, 'https://crm.example.com/')).toContain(
      '開く: https://crm.example.com/task/3',
    );
  });
});
