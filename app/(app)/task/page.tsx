/**
 * マイタスク(CLAUDE.md §5.20 / §8.1 `/task`)。自分が担当の未完了タスクを期日順に。
 */

import { PanelFilterBar, PanelHeader } from '@/components/layout/PanelHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/domain/auth';
import { sortMyTasks } from '@/lib/domain/task_pure';
import { listMyTasks } from '@/lib/domain/tasks';
import Link from 'next/link';
import { MyTaskList } from './MyTaskList';

export default async function MyTasksPage({
  searchParams,
}: { searchParams: Promise<{ done?: string }> }) {
  const sp = await searchParams;
  const showDone = sp.done === '1';
  const me = await getCurrentUser();
  const tasks = sortMyTasks(await listMyTasks(me.id, { includeCompleted: showDone }));

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel="TSK"
          iconColor="#f97316"
          objectLabel="タスク"
          viewName={showDone ? 'マイタスク(完了済み)' : 'マイタスク'}
          totalCount={tasks.length}
          actions={
            <div className="flex items-center gap-2">
              <Link href="/task/projects">
                <Button variant="outline" size="sm">
                  プロジェクト一覧
                </Button>
              </Link>
            </div>
          }
        />
        <PanelFilterBar>
          <div className="flex items-center gap-3 text-sm">
            <Link href="/task" className={showDone ? 'sf-link' : 'font-medium'}>
              未完了
            </Link>
            <Link href="/task?done=1" className={showDone ? 'font-medium' : 'sf-link'}>
              完了済み(直近 200 件)
            </Link>
          </div>
        </PanelFilterBar>
        <MyTaskList tasks={tasks} />
      </Card>
    </div>
  );
}
