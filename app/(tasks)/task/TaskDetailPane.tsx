/**
 * 一覧の右側に出すタスク詳細(分割ビュー。CLAUDE.md §5.20 / §8.1)。
 * 一覧ページが `?task=<id>` を受け取ったときに描画する。中身は /task/[id] と同じ TaskDetail を埋め込みモードで使う。
 */

import { getCurrentUser } from '@/lib/domain/auth';
import { getTask, listTaskSections } from '@/lib/domain/tasks';
import { listAllUsers } from '@/lib/domain/users_admin';
import { TaskDetail } from './[id]/TaskDetail';

export async function TaskDetailPane({
  taskId,
  closeHref,
}: {
  taskId: number;
  /** 「閉じる」で戻る一覧の URL(task パラメータを除いたもの) */
  closeHref: string;
}) {
  const [me, task] = await Promise.all([getCurrentUser(), getTask(taskId)]);
  if (!task) {
    return (
      <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        タスクが見つかりません(削除されたか、閲覧できないプロジェクトのタスクです)
      </div>
    );
  }
  const [sections, users] = await Promise.all([
    listTaskSections(task.project_id),
    listAllUsers({ activeOnly: true }),
  ]);
  return (
    <TaskDetail
      task={task}
      sections={sections}
      users={users.map((u) => ({ id: u.id, full_name: u.full_name }))}
      currentUserId={me.id}
      canEdit={me.role !== 'viewer'}
      isAdmin={me.role === 'admin'}
      embedded={{ closeHref, fullHref: `/task/${task.id}` }}
    />
  );
}
