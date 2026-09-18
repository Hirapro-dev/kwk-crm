/**
 * マイタスク(CLAUDE.md §5.20 / §8.1 `/task/my`)。自分が担当の未完了タスクを Asana 風に
 * 期限切れ / 今日 / 今後 7 日 / それ以降 / 期日なし に分けて一覧する。完了済みは切替で表示。
 * `?task=<id>` があれば右側にそのタスクの詳細を出す分割ビュー(2026-09-18)。
 */

import { getCurrentUser } from '@/lib/domain/auth';
import { groupMyTasksByDue, sortMyTasks, todayJst } from '@/lib/domain/task_pure';
import { listMyTasks } from '@/lib/domain/tasks';
import Link from 'next/link';
import { TaskDetailPane } from '../TaskDetailPane';
import { MyTaskList } from './MyTaskList';

export default async function MyTasksPage({
  searchParams,
}: { searchParams: Promise<{ done?: string; task?: string }> }) {
  const sp = await searchParams;
  const showDone = sp.done === '1';
  const selectedTaskId = sp.task && /^\d+$/.test(sp.task) ? Number(sp.task) : null;
  const listHref = `/task/my${showDone ? '?done=1' : ''}`;
  const me = await getCurrentUser();
  const tasks = await listMyTasks(me.id, { includeCompleted: showDone });
  const groups = showDone
    ? [{ key: 'done' as const, label: '完了済み(直近 200 件)', tasks: sortMyTasks(tasks) }]
    : groupMyTasksByDue(tasks, todayJst());

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold">マイタスク</h1>
        <div className="flex items-center gap-3 text-sm">
          <Link
            href={`/task/my${selectedTaskId ? `?task=${selectedTaskId}` : ''}`}
            className={showDone ? 'sf-link' : 'font-medium'}
          >
            未完了
          </Link>
          <Link
            href={`/task/my?done=1${selectedTaskId ? `&task=${selectedTaskId}` : ''}`}
            className={showDone ? 'font-medium' : 'sf-link'}
          >
            完了済み
          </Link>
        </div>
        <span className="text-xs text-muted-foreground">{tasks.length} 件</span>
      </div>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <MyTaskList groups={groups} />
        </div>
        {selectedTaskId !== null && (
          <aside className="sticky top-0 hidden max-h-[calc(100dvh-5.5rem)] w-[46%] min-w-[420px] shrink-0 overflow-y-auto md:block">
            <TaskDetailPane taskId={selectedTaskId} closeHref={listHref} />
          </aside>
        )}
      </div>
    </div>
  );
}
