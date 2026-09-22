'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { UserAvatar } from '@/components/users/UserAvatar';
import {
  createTask,
  createTaskSection,
  deleteTask,
  deleteTaskSection,
  renameTaskSection,
  updateTask,
} from '@/lib/domain/task_actions';
import { groupTasksBySection } from '@/lib/domain/task_pure';
import type { TaskRow, TaskSection } from '@/lib/domain/tasks';
import { MessageSquare, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import {
  AssigneeCell,
  CompleteCheck,
  DueBadge,
  DueDateCell,
  type UserOption,
} from '../../TaskBits';

/**
 * プロジェクトのリスト表示(§5.20)。セクション見出しごとにタスク行を並べ、行内で 完了・担当・期日・セクション を変更する。
 * セクションの追加・名前変更・削除、タスクの追加(セクション末尾)。
 */
interface Props {
  projectId: number;
  sections: TaskSection[];
  tasks: TaskRow[];
  users: UserOption[];
  canEdit: boolean;
  canManage: boolean;
  isAdmin: boolean;
}

export function ProjectTaskList({
  projectId,
  sections,
  tasks,
  users,
  canEdit,
  canManage,
  isAdmin,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // 行のクリックで右側に詳細を出す(分割ビュー)。URL の task パラメータで選択中のタスクを表す
  const selectedTask = searchParams.get('task');
  const taskHref = (id: number) => {
    const q = new URLSearchParams(searchParams.toString());
    q.set('task', String(id));
    return `${pathname}?${q.toString()}`;
  };
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const groups = useMemo(() => groupTasksBySection(sections, tasks), [sections, tasks]);
  const [addingIn, setAddingIn] = useState<number | 'none' | null>(null);
  const [newName, setNewName] = useState('');
  const [newSection, setNewSection] = useState('');
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);

  const run = (fn: () => Promise<{ error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      else router.refresh();
    });
  };

  const submitNewTask = (sectionId: number | null) => {
    const name = newName.trim();
    if (!name) return;
    run(async () => {
      const r = await createTask(projectId, { name, section_id: sectionId });
      if (!r.error) {
        setNewName('');
        setAddingIn(null);
      }
      return r;
    });
  };

  return (
    <div className="divide-y">
      {error && <p className="px-4 py-2 text-xs text-destructive">{error}</p>}
      {groups.map((g) => {
        const key = g.section?.id ?? 'none';
        return (
          <section key={key}>
            <div className="flex items-center gap-2 bg-gray-50 px-4 py-2">
              {renaming && g.section && renaming.id === g.section.id ? (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const sid = g.section?.id;
                    if (sid === undefined) return;
                    run(async () => {
                      const r = await renameTaskSection(sid, renaming.name);
                      if (!r.error) setRenaming(null);
                      return r;
                    });
                  }}
                >
                  <Input
                    value={renaming.name}
                    onChange={(e) => setRenaming({ id: renaming.id, name: e.target.value })}
                    className="h-7 w-64 text-sm"
                    autoFocus
                  />
                  <Button type="submit" size="sm" variant="outline" disabled={pending}>
                    保存
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>
                    取消
                  </Button>
                </form>
              ) : (
                <button
                  type="button"
                  className="text-sm font-semibold text-slate-700 hover:underline disabled:no-underline"
                  disabled={!canEdit || !g.section}
                  onClick={() =>
                    g.section && setRenaming({ id: g.section.id, name: g.section.name })
                  }
                  title={g.section ? 'クリックで名前を変更' : undefined}
                >
                  {g.section?.name ?? '(セクションなし)'}
                </button>
              )}
              <span className="text-xs text-muted-foreground">{g.tasks.length}</span>
              {canEdit && (
                <button
                  type="button"
                  className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  onClick={() => {
                    setAddingIn(g.section?.id ?? 'none');
                    setNewName('');
                  }}
                >
                  <Plus className="h-3 w-3" /> タスクを追加
                </button>
              )}
              {canManage && g.section && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-destructive"
                  title="セクションを削除(中のタスクは「セクションなし」に移ります)"
                  onClick={() => {
                    const sid = g.section?.id;
                    if (sid === undefined) return;
                    if (
                      !confirm(`セクション「${g.section?.name}」を削除しますか?(タスクは残ります)`)
                    )
                      return;
                    run(() => deleteTaskSection(sid));
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <ul className="divide-y">
              {g.tasks.map((t) => (
                <li
                  key={t.id}
                  className={`flex items-center gap-3 px-3 py-2.5 hover:bg-accent/30 sm:py-1.5 sm:px-4 ${selectedTask === String(t.id) ? 'bg-accent/50' : ''}`}
                >
                  <CompleteCheck taskId={t.id} completed={!!t.completed_at} />
                  <Link
                    href={taskHref(t.id)}
                    scroll={false}
                    className={`min-w-0 flex-1 text-base sm:truncate sm:text-sm ${t.completed_at ? 'text-muted-foreground line-through' : 'text-foreground sm:hover:underline'}`}
                  >
                    <span className="block truncate">{t.name}</span>
                    {/* スマホ: 2 行目に会員(担当はアイコンで右に)。編集は詳細で */}
                    {(t.member || (!t.assignee && t.assignee_name_raw)) && (
                      <span className="block truncate text-xs text-muted-foreground sm:hidden">
                        {t.member
                          ? (t.member.name ?? t.member.id)
                          : `${t.assignee_name_raw}(未登録)`}
                      </span>
                    )}
                  </Link>
                  {/* スマホ: 担当はアイコンのみ(migration 114) */}
                  {t.assignee && (
                    <span className="sm:hidden">
                      <UserAvatar
                        name={t.assignee.full_name}
                        avatarPath={t.assignee.avatar_path}
                        size={24}
                      />
                    </span>
                  )}
                  <span className="sm:hidden">
                    <DueBadge dueDate={t.due_date} completedAt={t.completed_at} />
                  </span>
                  <div className="hidden items-center gap-3 sm:contents">
                    {(t.subtask_count ?? 0) > 0 && (
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        サブ {t.subtask_count}
                      </span>
                    )}
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
                    {canEdit ? (
                      <>
                        <AssigneeCell
                          taskId={t.id}
                          assigneeId={t.assignee_id}
                          assigneeNameRaw={t.assignee_name_raw}
                          users={users}
                        />
                        <DueDateCell
                          taskId={t.id}
                          dueDate={t.due_date}
                          completedAt={t.completed_at}
                        />
                        <Select
                          value={t.section_id ?? ''}
                          className="h-9 max-w-[200px] border-input bg-background px-1 text-base sm:h-7 sm:max-w-[140px] sm:border-transparent sm:bg-transparent sm:text-xs sm:hover:border-input"
                          aria-label="セクション"
                          disabled={pending}
                          onChange={(e) => {
                            const v = e.target.value;
                            run(() => updateTask(t.id, { section_id: v ? Number(v) : null }));
                          }}
                        >
                          <option value="">(セクションなし)</option>
                          {sections.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </Select>
                      </>
                    ) : (
                      <>
                        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                          {t.assignee && (
                            <UserAvatar
                              name={t.assignee.full_name}
                              avatarPath={t.assignee.avatar_path}
                              size={22}
                            />
                          )}
                          {t.assignee?.full_name ?? t.assignee_name_raw ?? '-'}
                        </span>
                        <DueDateCell
                          taskId={t.id}
                          dueDate={t.due_date}
                          completedAt={t.completed_at}
                          editable={false}
                        />
                      </>
                    )}
                    {isAdmin && (
                      <button
                        type="button"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        title="タスクを削除"
                        onClick={() => {
                          if (!confirm(`「${t.name}」を削除しますか?(サブタスクも削除されます)`))
                            return;
                          run(() => deleteTask(t.id));
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </li>
              ))}
              {addingIn === (g.section?.id ?? 'none') && (
                <li className="px-4 py-2">
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      submitNewTask(g.section?.id ?? null);
                    }}
                  >
                    <Input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="タスク名を入力して Enter"
                      className="h-8 text-sm"
                      autoFocus
                    />
                    <Button type="submit" size="sm" disabled={pending || !newName.trim()}>
                      追加
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setAddingIn(null)}
                    >
                      取消
                    </Button>
                  </form>
                </li>
              )}
            </ul>
          </section>
        );
      })}
      {canEdit && (
        <form
          className="flex items-center gap-2 px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            const n = newSection.trim();
            if (!n) return;
            run(async () => {
              const r = await createTaskSection(projectId, n);
              if (!r.error) setNewSection('');
              return r;
            });
          }}
        >
          <Input
            value={newSection}
            onChange={(e) => setNewSection(e.target.value)}
            placeholder="新しいセクション名"
            className="h-8 w-64 text-sm"
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={pending || !newSection.trim()}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> セクションを追加
          </Button>
        </form>
      )}
    </div>
  );
}
