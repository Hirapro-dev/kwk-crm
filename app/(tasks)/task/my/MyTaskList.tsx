'use client';

import type { TaskRow } from '@/lib/domain/tasks';
import { ChevronDown, ChevronRight, MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { CompleteCheck, DueBadge, DueDateCell } from '../TaskBits';

/**
 * マイタスクの一覧(§5.20)。期日ごとのグループ見出し(クリックで開閉)+ 行(完了・名前・プロジェクト・会員・期日)。
 * スマホ(sm 未満)は Asana のアプリ風に 名前 / プロジェクト名 の 2 行と期日バッジ、PC は従来の 1 行(期日は編集可)。
 */
export function MyTaskList({
  groups,
}: { groups: Array<{ key: string; label: string; tasks: TaskRow[] }> }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // 行のクリックで右側に詳細を出す(分割ビュー)。URL の task パラメータで選択中のタスクを表す
  const selectedTask = searchParams.get('task');
  const taskHref = (id: number) => {
    const q = new URLSearchParams(searchParams.toString());
    q.set('task', String(id));
    return `${pathname}?${q.toString()}`;
  };
  if (groups.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
        タスクはありません
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <section key={g.key} className="rounded-lg border bg-card">
          <h2>
            <button
              type="button"
              onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}
              className="flex w-full items-center gap-2 border-b px-3 py-2.5 text-left text-sm font-semibold sm:px-4 sm:py-2"
              aria-expanded={!collapsed[g.key]}
            >
              {collapsed[g.key] ? (
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              ) : (
                <ChevronDown
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
              {g.label}
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                {g.tasks.length}
              </span>
            </button>
          </h2>
          <ul className={collapsed[g.key] ? 'hidden' : 'divide-y'}>
            {g.tasks.map((t) => (
              <li
                key={t.id}
                className={`flex items-center gap-3 px-3 py-2.5 hover:bg-accent/30 sm:py-1.5 sm:px-4 ${selectedTask === String(t.id) ? 'bg-accent/50' : ''}`}
              >
                <CompleteCheck taskId={t.id} completed={!!t.completed_at} />
                <Link
                  href={taskHref(t.id)}
                  scroll={false}
                  className={`min-w-0 flex-1 text-base sm:truncate sm:text-sm ${t.completed_at ? 'text-muted-foreground line-through' : 'sm:hover:underline'}`}
                >
                  <span className="block truncate">{t.name}</span>
                  {/* スマホ: 2 行目にプロジェクト名 */}
                  {t.project && (
                    <span className="block truncate text-xs text-muted-foreground sm:hidden">
                      {t.project.name}
                    </span>
                  )}
                </Link>
                {/* スマホ: 期日バッジ(編集は詳細で) */}
                <span className="sm:hidden">
                  <DueBadge dueDate={t.due_date} completedAt={t.completed_at} />
                </span>
                <div className="hidden items-center gap-3 sm:contents">
                  {(t.comment_count ?? 0) > 0 && (
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground">
                      <MessageSquare className="h-3 w-3" /> {t.comment_count}
                    </span>
                  )}
                  {t.member && (
                    <a
                      href={`/members/${t.member.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="sf-link shrink-0 text-xs"
                    >
                      {t.member.name ?? t.member.id}
                    </a>
                  )}
                  {t.project && (
                    <Link
                      href={`/task/projects/${t.project.id}`}
                      className="inline-flex max-w-[200px] shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px]"
                      style={{ backgroundColor: `${t.project.color ?? '#94a3b8'}22` }}
                      title={t.project.name}
                    >
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: t.project.color ?? '#94a3b8' }}
                      />
                      <span className="truncate">{t.project.name}</span>
                    </Link>
                  )}
                  <DueDateCell taskId={t.id} dueDate={t.due_date} completedAt={t.completed_at} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
