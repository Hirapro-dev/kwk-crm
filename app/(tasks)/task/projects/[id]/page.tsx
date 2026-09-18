/**
 * プロジェクトのリスト表示(CLAUDE.md §5.20 / §8.1 `/task/projects/[id]`)。セクションごとにタスクを並べる。
 */

import { PanelFilterBar, PanelHeader } from '@/components/layout/PanelHeader';
import { Card } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/domain/auth';
import {
  getTaskProject,
  listProjectTasks,
  listTaskProjectMembers,
  listTaskSections,
} from '@/lib/domain/tasks';
import { listAllUsers } from '@/lib/domain/users_admin';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NewTaskProjectDialog } from '../NewTaskProjectDialog';
import { ProjectTaskList } from './ProjectTaskList';

export default async function TaskProjectPage({
  params,
  searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const projectId = Number(id);
  if (!Number.isInteger(projectId)) notFound();
  const showDone = sp.done === '1';
  const [me, project] = await Promise.all([getCurrentUser(), getTaskProject(projectId)]);
  if (!project) notFound();
  const [sections, tasks, users, members] = await Promise.all([
    listTaskSections(projectId),
    listProjectTasks(projectId, { includeCompleted: showDone }),
    listAllUsers({ activeOnly: true }),
    listTaskProjectMembers(projectId),
  ]);
  const canManage = me.role === 'admin' || project.created_by === me.id;
  const userOptions = users.map((u) => ({ id: u.id, full_name: u.full_name }));

  return (
    <div className="space-y-3">
      <Link href="/task/projects" className="sf-back-link text-xs">
        ← プロジェクト一覧へ
      </Link>
      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel="TSK"
          iconColor={project.color ?? '#f97316'}
          objectLabel={project.visibility === 'private' ? 'タスク(メンバーのみ)' : 'タスク'}
          viewName={project.name}
          totalCount={tasks.length}
          actions={
            <div className="flex items-center gap-2">
              {canManage && (
                <NewTaskProjectDialog
                  users={userOptions}
                  currentUserId={me.id}
                  project={{
                    id: project.id,
                    name: project.name,
                    color: project.color,
                    description: project.description,
                    visibility: project.visibility,
                    is_archived: project.is_archived,
                    memberIds: members.map((m) => m.user_id),
                  }}
                  triggerLabel="設定"
                />
              )}
            </div>
          }
        />
        <PanelFilterBar>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Link
              href={`/task/projects/${projectId}`}
              className={showDone ? 'sf-link' : 'font-medium'}
            >
              未完了
            </Link>
            <Link
              href={`/task/projects/${projectId}?done=1`}
              className={showDone ? 'font-medium' : 'sf-link'}
            >
              完了も表示
            </Link>
            {project.description && (
              <span className="text-xs text-muted-foreground">{project.description}</span>
            )}
            {project.is_archived && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px]">アーカイブ済み</span>
            )}
          </div>
        </PanelFilterBar>
        <ProjectTaskList
          projectId={projectId}
          sections={sections}
          tasks={tasks}
          users={userOptions}
          canEdit={me.role !== 'viewer'}
          canManage={canManage}
          isAdmin={me.role === 'admin'}
        />
      </Card>
    </div>
  );
}
