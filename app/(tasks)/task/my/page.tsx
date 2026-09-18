/**
 * マイタスク(CLAUDE.md §5.20 / §8.1 `/task/my`)。自分が担当の未完了タスクを Asana 風に
 * 期限切れ / 今日 / 今後 7 日 / それ以降 / 期日なし に分けて一覧する。完了済みは切替で表示。
 */

import { getCurrentUser } from '@/lib/domain/auth';
import { groupMyTasksByDue, sortMyTasks, todayJst } from '@/lib/domain/task_pure';
import { listMyTasks } from '@/lib/domain/tasks';
import Link from 'next/link';
import { MyTaskList } from './MyTaskList';

export default async function MyTasksPage({
  searchParams,
}: { searchParams: Promise<{ done?: string }> }) {
  const sp = await searchParams;
  const showDone = sp.done === '1';
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
          <Link href="/task/my" className={showDone ? 'sf-link' : 'font-medium'}>
            未完了
          </Link>
          <Link href="/task/my?done=1" className={showDone ? 'font-medium' : 'sf-link'}>
            完了済み
          </Link>
        </div>
        <span className="text-xs text-muted-foreground">{tasks.length} 件</span>
      </div>
      <MyTaskList groups={groups} />
    </div>
  );
}
