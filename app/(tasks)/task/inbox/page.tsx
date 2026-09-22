/**
 * 受信トレイ(CLAUDE.md §5.20 / §8.1 `/task/inbox`。migration 115)。
 * 自分宛のメンション(コメントで「@氏名」と呼ばれたもの)を新しい順に出す。開くとそのタスクで既読になる。
 */

import { UserAvatar } from '@/components/users/UserAvatar';
import { getCurrentUser } from '@/lib/domain/auth';
import { listMyMentions } from '@/lib/domain/tasks';
import { formatDateTime } from '@/lib/utils/date';
import Link from 'next/link';

export default async function TaskInboxPage() {
  await getCurrentUser();
  const rows = await listMyMentions();
  const unread = rows.filter((r) => !r.read_at).length;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold md:text-lg">受信トレイ</h1>
        <span className="text-xs text-muted-foreground">
          {unread > 0 ? `未読 ${unread} 件` : `${rows.length} 件`}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
          コメントで「@あなたの氏名」と呼ばれると、ここに届きます
        </div>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`/task/${r.task_id}`}
                className={`flex gap-3 px-3 py-3 hover:bg-accent/40 ${r.read_at ? '' : 'bg-sky-50/60'}`}
              >
                <UserAvatar
                  name={r.author?.full_name}
                  avatarPath={r.author?.avatar_path}
                  size={32}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`truncate text-sm ${r.read_at ? '' : 'font-semibold'}`}>
                      {r.task?.name ?? '(タスク)'}
                    </span>
                    {!r.read_at && (
                      <span
                        className="h-2 w-2 shrink-0 rounded-full bg-sky-500"
                        aria-label="未読"
                      />
                    )}
                  </div>
                  <p className="line-clamp-2 text-sm text-foreground/90">
                    <span className="font-medium">{r.author?.full_name ?? '(不明)'}</span>
                    {' さんがあなたを呼びました: '}
                    {r.comment?.body ?? ''}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {r.task?.project?.name ? `${r.task.project.name} · ` : ''}
                    {formatDateTime(r.created_at)}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
