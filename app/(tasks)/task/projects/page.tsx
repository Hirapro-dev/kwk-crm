/**
 * タスクのプロジェクト一覧(CLAUDE.md §5.20 / §8.1 `/task/projects`)。閲覧できるものだけ(RLS)。
 */

import { PanelFilterBar, PanelHeader } from '@/components/layout/PanelHeader';
import { Card } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/domain/auth';
import { listTaskProjects } from '@/lib/domain/tasks';
import { listAllUsers } from '@/lib/domain/users_admin';
import Link from 'next/link';
import { NewTaskProjectDialog } from './NewTaskProjectDialog';

export default async function TaskProjectsPage({
  searchParams,
}: { searchParams: Promise<{ archived?: string; new?: string }> }) {
  const sp = await searchParams;
  const showArchived = sp.archived === '1';
  const [me, projects, users] = await Promise.all([
    getCurrentUser(),
    listTaskProjects({ includeArchived: showArchived }),
    listAllUsers({ activeOnly: true }),
  ]);
  const rows = showArchived ? projects.filter((p) => p.is_archived) : projects;

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel="TSK"
          iconColor="#f97316"
          objectLabel="タスク"
          viewName={showArchived ? 'プロジェクト(アーカイブ済み)' : 'プロジェクト'}
          totalCount={rows.length}
          actions={
            <div className="flex items-center gap-2">
              {me.role !== 'viewer' && (
                <NewTaskProjectDialog
                  users={users.map((u) => ({ id: u.id, full_name: u.full_name }))}
                  currentUserId={me.id}
                  defaultOpen={sp.new === '1'}
                />
              )}
            </div>
          }
        />
        <PanelFilterBar>
          <div className="flex items-center gap-3 text-sm">
            <Link href="/task/projects" className={showArchived ? 'sf-link' : 'font-medium'}>
              有効
            </Link>
            <Link
              href="/task/projects?archived=1"
              className={showArchived ? 'font-medium' : 'sf-link'}
            >
              アーカイブ済み
            </Link>
          </div>
        </PanelFilterBar>
        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">プロジェクトはありません</p>
        ) : (
          <ul className="divide-y">
            {rows.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/task/projects/${p.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-accent/40"
                >
                  <span
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ backgroundColor: p.color ?? '#94a3b8' }}
                  />
                  <span className="font-medium">{p.name}</span>
                  {p.visibility === 'private' && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">
                      メンバーのみ
                    </span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    未完了 {p.open_count ?? 0} 件
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
