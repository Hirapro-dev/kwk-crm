'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { UserAvatar } from '@/components/users/UserAvatar';
import { type MemberBrief, searchMembersForInquiry } from '@/lib/domain/inquiry_lead_actions';
import {
  addTaskComment,
  createTask,
  deleteTask,
  deleteTaskAttachment,
  deleteTaskComment,
  getTaskAttachmentUrl,
  markTaskMentionsRead,
  updateTask,
  uploadTaskAttachment,
} from '@/lib/domain/task_actions';
import type { TaskDetail as TaskDetailData, TaskSection } from '@/lib/domain/tasks';
import { formatDateTime } from '@/lib/utils/date';
import { Maximize2, Paperclip, Pencil, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { LinkifiedText } from '../LinkifiedText';
import { AssigneeCell, CompleteCheck, DueDateCell, type UserOption } from '../TaskBits';
import { MentionTextarea } from './MentionTextarea';

interface Props {
  task: TaskDetailData;
  sections: TaskSection[];
  users: UserOption[];
  currentUserId: string;
  canEdit: boolean;
  isAdmin: boolean;
  /** 一覧の右側に埋め込むとき(分割ビュー)。閉じる先と全画面(/task/[id])の URL */
  embedded?: { closeHref: string; fullHref: string };
}

export function TaskDetail({
  task,
  sections,
  users,
  currentUserId,
  canEdit,
  isAdmin,
  embedded,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(task.name);
  const [notes, setNotes] = useState(task.notes ?? '');
  const [notesDirty, setNotesDirty] = useState(false);
  // 説明は普段はリンク化した表示にし、「編集」でテキストエリアに切り替える(URL をクリックできるように)
  const [notesEditing, setNotesEditing] = useState(false);
  const [startDate, setStartDate] = useState(task.start_date ?? '');
  const [comment, setComment] = useState('');
  const [subName, setSubName] = useState('');
  const [memberQuery, setMemberQuery] = useState('');
  const [memberResults, setMemberResults] = useState<MemberBrief[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // 開いたら、このタスクの自分宛メンションを既読にする(受信トレイのバッジ用。migration 115)
  // biome-ignore lint/correctness/useExhaustiveDependencies: タスクが変わったときだけ
  useEffect(() => {
    markTaskMentionsRead(task.id).then((r) => {
      if (!r.error) router.refresh();
    });
  }, [task.id]);
  const mentionNames = users.map((u) => (u.full_name ?? '').trim()).filter(Boolean);

  const run = (fn: () => Promise<{ error?: string }>, after?: () => void) => {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      else {
        after?.();
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs">
        {embedded ? (
          <span className="truncate text-muted-foreground">
            {task.project?.name ?? 'プロジェクト'}
          </span>
        ) : (
          <Link href={`/task/projects/${task.project_id}`} className="sf-back-link">
            ← {task.project?.name ?? 'プロジェクト'}
          </Link>
        )}
        {task.parent && (
          <Link
            href={
              embedded ? parentHref(embedded.closeHref, task.parent.id) : `/task/${task.parent.id}`
            }
            className="sf-link truncate"
          >
            親タスク: {task.parent.name}
          </Link>
        )}
        {embedded && (
          <span className="ml-auto flex shrink-0 items-center gap-1">
            <Link
              href={embedded.fullHref}
              className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="全画面で開く"
            >
              <Maximize2 className="h-3.5 w-3.5" /> 全画面
            </Link>
            <Link
              href={embedded.closeHref}
              className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="閉じる"
              aria-label="閉じる"
            >
              <X className="h-4 w-4" />
            </Link>
          </span>
        )}
      </div>

      <Card className="space-y-4 p-4">
        <div className="flex items-start gap-3">
          <div className="pt-1">
            <CompleteCheck taskId={task.id} completed={!!task.completed_at} />
          </div>
          {canEdit ? (
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                if (name.trim() && name !== task.name) run(() => updateTask(task.id, { name }));
              }}
              className="h-10 border-transparent text-lg font-semibold hover:border-input focus:border-input"
              aria-label="タスク名"
            />
          ) : (
            <h1 className="text-lg font-semibold">{task.name}</h1>
          )}
          {isAdmin && (
            <button
              type="button"
              className="ml-auto text-muted-foreground hover:text-destructive"
              title="タスクを削除"
              onClick={() => {
                if (!confirm(`「${task.name}」を削除しますか?(サブタスクも削除されます)`)) return;
                run(
                  () => deleteTask(task.id),
                  () =>
                    router.push(
                      embedded ? embedded.closeHref : `/task/projects/${task.project_id}`,
                    ),
                );
              }}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
        {task.completed_at && (
          <p className="text-xs text-emerald-700">完了: {formatDateTime(task.completed_at)}</p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}

        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">担当</Label>
            <div>
              {canEdit ? (
                <AssigneeCell
                  taskId={task.id}
                  assigneeId={task.assignee_id}
                  assigneeNameRaw={task.assignee_name_raw}
                  users={users}
                />
              ) : (
                <span>{task.assignee?.full_name ?? task.assignee_name_raw ?? '-'}</span>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">期日</Label>
            <div>
              <DueDateCell
                taskId={task.id}
                dueDate={task.due_date}
                completedAt={task.completed_at}
                editable={canEdit}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">開始日</Label>
            <Input
              type="date"
              value={startDate}
              disabled={!canEdit || pending}
              onChange={(e) => {
                setStartDate(e.target.value);
                run(() => updateTask(task.id, { start_date: e.target.value || null }));
              }}
              className="h-8 w-44 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">セクション</Label>
            <Select
              value={task.section_id ?? ''}
              disabled={!canEdit || pending}
              onChange={(e) =>
                run(() =>
                  updateTask(task.id, {
                    section_id: e.target.value ? Number(e.target.value) : null,
                  }),
                )
              }
              className="h-8 w-60 text-xs"
            >
              <option value="">(セクションなし)</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs text-muted-foreground">会員</Label>
            {task.member ? (
              <div className="flex items-center gap-2">
                <a
                  href={`/members/${task.member.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sf-link"
                >
                  {task.member.name ?? task.member.id}{' '}
                  <span className="font-mono text-xs text-muted-foreground">{task.member.id}</span>
                </a>
                {canEdit && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => run(() => updateTask(task.id, { member_id: null }))}
                  >
                    解除
                  </Button>
                )}
              </div>
            ) : canEdit ? (
              <div className="space-y-1">
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    startTransition(async () => {
                      const r = await searchMembersForInquiry(memberQuery);
                      if (r.error) setError(r.error);
                      setMemberResults(r.members ?? []);
                    });
                  }}
                >
                  <Input
                    value={memberQuery}
                    onChange={(e) => setMemberQuery(e.target.value)}
                    placeholder="氏名・メール・電話・会員IDで検索"
                    className="h-8 w-72 text-xs"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    variant="outline"
                    disabled={pending || !memberQuery.trim()}
                  >
                    検索
                  </Button>
                </form>
                {memberResults && (
                  <ul className="max-h-40 overflow-y-auto rounded border text-xs">
                    {memberResults.length === 0 && (
                      <li className="p-2 text-muted-foreground">該当する会員がありません</li>
                    )}
                    {memberResults.map((m) => (
                      <li
                        key={m.id}
                        className="flex items-center gap-2 border-t p-2 first:border-t-0"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {m.name ?? '(氏名なし)'}{' '}
                          <span className="font-mono text-muted-foreground">{m.id}</span>
                          <span className="ml-2 text-muted-foreground">
                            {[m.phone1, m.email1].filter(Boolean).join(' / ')}
                          </span>
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() =>
                            run(
                              () => updateTask(task.id, { member_id: m.id }),
                              () => setMemberResults(null),
                            )
                          }
                        >
                          紐付け
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <span>-</span>
            )}
          </div>
        </dl>

        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">説明</Label>
            {canEdit && !notesEditing && (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setNotesEditing(true)}
              >
                <Pencil className="h-3 w-3" /> 編集
              </button>
            )}
          </div>
          {canEdit && notesEditing ? (
            <>
              <Textarea
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                  setNotesDirty(true);
                }}
                rows={Math.min(24, Math.max(6, notes.split('\n').length + 1))}
                className="text-sm"
                autoFocus
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={pending || !notesDirty}
                  onClick={() =>
                    run(
                      () => updateTask(task.id, { notes }),
                      () => {
                        setNotesDirty(false);
                        setNotesEditing(false);
                      },
                    )
                  }
                >
                  説明を保存
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setNotes(task.notes ?? '');
                    setNotesDirty(false);
                    setNotesEditing(false);
                  }}
                >
                  取消
                </Button>
              </div>
            </>
          ) : task.notes ? (
            // URL はクリックで別タブに開く(splitLinks)
            <LinkifiedText text={task.notes} />
          ) : (
            <p className="text-sm text-muted-foreground">-</p>
          )}
        </div>
      </Card>

      {/* サブタスク */}
      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold">サブタスク({task.subtasks.length})</h2>
        <ul className="divide-y">
          {task.subtasks.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-1.5">
              <CompleteCheck taskId={s.id} completed={!!s.completed_at} />
              <Link
                href={`/task/${s.id}`}
                className={`min-w-0 flex-1 truncate text-sm hover:underline ${s.completed_at ? 'text-muted-foreground line-through' : ''}`}
              >
                {s.name}
              </Link>
              <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                {s.assignee && (
                  <UserAvatar
                    name={s.assignee.full_name}
                    avatarPath={s.assignee.avatar_path}
                    size={20}
                  />
                )}
                <span className="hidden sm:inline">
                  {s.assignee?.full_name ?? s.assignee_name_raw ?? ''}
                </span>
              </span>
              <DueDateCell
                taskId={s.id}
                dueDate={s.due_date}
                completedAt={s.completed_at}
                editable={canEdit}
              />
            </li>
          ))}
        </ul>
        {canEdit && !task.parent_task_id && (
          <form
            className="mt-2 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const n = subName.trim();
              if (!n) return;
              run(
                () =>
                  createTask(task.project_id, {
                    name: n,
                    parent_task_id: task.id,
                    section_id: task.section_id,
                  }),
                () => setSubName(''),
              );
            }}
          >
            <Input
              value={subName}
              onChange={(e) => setSubName(e.target.value)}
              placeholder="サブタスクを追加"
              className="h-8 text-sm"
            />
            <Button type="submit" size="sm" variant="outline" disabled={pending || !subName.trim()}>
              追加
            </Button>
          </form>
        )}
      </Card>

      {/* 添付 */}
      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold">添付({task.attachments.length})</h2>
        <ul className="divide-y text-sm">
          {task.attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-2 py-1.5">
              <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
              <button
                type="button"
                className="sf-link min-w-0 flex-1 truncate text-left"
                onClick={() =>
                  startTransition(async () => {
                    const r = await getTaskAttachmentUrl(a.id);
                    if (r.error || !r.data) setError(r.error ?? 'URL の発行に失敗しました');
                    else window.open(r.data.url, '_blank', 'noopener');
                  })
                }
              >
                {a.filename}
              </button>
              <span className="shrink-0 text-xs text-muted-foreground">
                {a.size_bytes != null ? `${Math.max(1, Math.round(a.size_bytes / 1024))} KB` : ''}
              </span>
              {(isAdmin || a.uploaded_by === currentUserId) && (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive"
                  title="添付を削除"
                  onClick={() => {
                    if (!confirm(`「${a.filename}」を削除しますか?`)) return;
                    run(() => deleteTaskAttachment(a.id, task.id));
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
        {canEdit && (
          <form
            className="mt-2 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const f = fileRef.current?.files?.[0];
              if (!f) return;
              const fd = new FormData();
              fd.set('taskId', String(task.id));
              fd.set('file', f);
              run(
                () => uploadTaskAttachment(fd),
                () => {
                  if (fileRef.current) fileRef.current.value = '';
                },
              );
            }}
          >
            <input ref={fileRef} type="file" className="text-xs" />
            <Button type="submit" size="sm" variant="outline" disabled={pending}>
              アップロード(25MB まで)
            </Button>
          </form>
        )}
      </Card>

      {/* コメント */}
      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold">コメント({task.comments.length})</h2>
        <ul className="space-y-3">
          {task.comments.map((c) => (
            <li key={c.id} className="rounded border p-2 text-sm">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <UserAvatar
                  name={c.user?.full_name ?? c.author_name_raw}
                  avatarPath={c.user?.avatar_path}
                  size={22}
                />
                <span className="font-medium text-foreground">
                  {c.user?.full_name ?? c.author_name_raw ?? '(不明)'}
                </span>
                <span>{formatDateTime(c.created_at)}</span>
                {(isAdmin || c.user_id === currentUserId) && (
                  <button
                    type="button"
                    className="ml-auto hover:text-destructive"
                    title="コメントを削除"
                    onClick={() => {
                      if (!confirm('このコメントを削除しますか?')) return;
                      run(() => deleteTaskComment(c.id, task.id));
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <LinkifiedText
                text={c.body}
                className="whitespace-pre-wrap"
                mentionNames={mentionNames}
              />
            </li>
          ))}
        </ul>
        {canEdit && (
          <form
            className="mt-3 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!comment.trim()) return;
              run(
                () => addTaskComment(task.id, comment),
                () => setComment(''),
              );
            }}
          >
            <MentionTextarea
              value={comment}
              onChange={setComment}
              users={users}
              rows={3}
              placeholder="コメントを書く(@氏名 で呼べます)"
              disabled={pending}
            />
            <Button type="submit" size="sm" disabled={pending || !comment.trim()}>
              コメントする
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}

/** 分割ビューで親タスクを開く URL(一覧の URL の task パラメータを差し替える) */
function parentHref(closeHref: string, parentId: number): string {
  return `${closeHref}${closeHref.includes('?') ? '&' : '?'}task=${parentId}`;
}
