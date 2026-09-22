/**
 * タスク検索(CLAUDE.md §5.20 / §8.1 `/task/search`。2026-09-22)。
 * タスク名とプロジェクト名の部分一致。スマホの下タブ「検索」から使う(PC でも使える)。
 */

import { getCurrentUser } from '@/lib/domain/auth';
import { listTaskProjects, searchTasks } from '@/lib/domain/tasks';
import { ListTodo } from 'lucide-react';
import Link from 'next/link';
import { CompleteCheck, DueBadge } from '../TaskBits';
import { SearchForm } from './SearchForm';

export default async function TaskSearchPage({
  searchParams,
}: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  await getCurrentUser();
  const [tasks, projects] = q ? await Promise.all([searchTasks(q), listTaskProjects()]) : [[], []];
  const term = q.toLowerCase();
  const projectHits = q ? projects.filter((p) => p.name.toLowerCase().includes(term)) : [];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold md:text-lg">検索</h1>
      <SearchForm initialQuery={q} />
      {q && (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground">
              プロジェクト({projectHits.length})
            </h2>
            {projectHits.length > 0 && (
              <ul className="divide-y rounded-lg border bg-card">
                {projectHits.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/task/projects/${p.id}`}
                      className="flex items-center gap-3 px-3 py-2.5 hover:bg-accent/40"
                    >
                      <span
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white"
                        style={{ backgroundColor: p.color ?? '#94a3b8' }}
                      >
                        <ListTodo className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground">
              タスク({tasks.length}
              {tasks.length >= 50 ? '+' : ''})
            </h2>
            {tasks.length === 0 ? (
              <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
                該当するタスクはありません
              </p>
            ) : (
              <ul className="divide-y rounded-lg border bg-card">
                {tasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-3 py-2.5">
                    <CompleteCheck taskId={t.id} completed={!!t.completed_at} />
                    <Link href={`/task/${t.id}`} className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-base md:text-sm ${t.completed_at ? 'text-muted-foreground line-through' : ''}`}
                      >
                        {t.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {t.project?.name ?? ''}
                        {(t.assignee?.full_name ?? t.assignee_name_raw)
                          ? ` · ${t.assignee?.full_name ?? t.assignee_name_raw}`
                          : ''}
                      </span>
                    </Link>
                    <DueBadge dueDate={t.due_date} completedAt={t.completed_at} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
