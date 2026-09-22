/**
 * プロジェクトのリスト表示(CLAUDE.md §5.20 / §8.1 `/task/projects/[id]`)。セクションごとにタスクを並べる。
 * `?task=<id>` があれば右側にそのタスクの詳細を出す分割ビュー(Asana と同じ。2026-09-18)。
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
import { TaskDetailPane } from '../../TaskDetailPane';
import { NewTaskProjectDialog } from '../NewTaskProjectDialog';
import { ProjectTaskList } from './ProjectTaskList';

export default async function TaskProjectPage({
  params,
  searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string; task?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const projectId = Number(id);
  if (!Number.isInteger(projectId)) notFound();
  const showDone = sp.done === '1';
  // 分割ビュー: 選択中のタスク(不正な値は無視)
  const selectedTaskId = sp.task && /^\d+$/.test(sp.task) ? Number(sp.task) : null;
  const listHref = `/task/projects/${projectId}${showDone ? '?done=1' : ''}`;
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
      <div className="flex items-start gap-3">
        {/* スマホ(md 未満)ではタスクを選ぶと一覧の代わりに詳細を全幅で出す(「閉じる」で一覧へ戻る) */}
        <Card
          className={`min-w-0 flex-1 overflow-hidden p-0 shadow-sm ${selectedTaskId !== null ? 'hidden md:block' : ''}`}
        >
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
                href={`/task/projects/${projectId}${selectedTaskId ? `?task=${selectedTaskId}` : ''}`}
                className={showDone ? 'sf-link' : 'font-medium'}
              >
                未完了
              </Link>
              <Link
                href={`/task/projects/${projectId}?done=1${selectedTaskId ? `&task=${selectedTaskId}` : ''}`}
                className={showDone ? 'font-medium' : 'sf-link'}
              >
                完了も表示
              </Link>
              {project.description && (
                <span className="text-xs text-muted-foreground">{project.description}</span>
              )}
              {project.is_archived && (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px]">
                  アーカイブ済み
                </span>
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
        {selectedTaskId !== null && (
          // 右側の詳細。一覧とは別にスクロールする(main がスクロール領域なので sticky が効く)
          <aside className="w-full min-w-0 md:sticky md:top-0 md:max-h-[calc(100dvh-5.5rem)] md:w-[46%] md:min-w-[420px] md:shrink-0 md:overflow-y-auto">
            <TaskDetailPane taskId={selectedTaskId} closeHref={listHref} />
          </aside>
        )}
      </div>
    </div>
  );
}
