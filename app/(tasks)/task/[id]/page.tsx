/**
 * タスク詳細(CLAUDE.md §5.20 / §8.1 `/task/[id]`)。説明・担当・期日・セクション・会員・サブタスク・コメント・添付。
 */

import { getCurrentUser } from '@/lib/domain/auth';
import { getTask, listTaskSections } from '@/lib/domain/tasks';
import { listAllUsers } from '@/lib/domain/users_admin';
import { notFound } from 'next/navigation';
import { TaskDetail } from './TaskDetail';

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const taskId = Number(id);
  if (!Number.isInteger(taskId)) notFound();
  const [me, task] = await Promise.all([getCurrentUser(), getTask(taskId)]);
  if (!task) notFound();
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
    />
  );
}
