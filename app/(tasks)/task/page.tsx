/**
 * タスク管理のホーム(CLAUDE.md §5.20 / §8.1 `/task`)。Asana のホーム風に、自分の未完了タスクの概況と
 * 参加プロジェクトのカードを出す。
 */

import { getCurrentUser } from '@/lib/domain/auth';
import { groupMyTasksByDue, todayJst } from '@/lib/domain/task_pure';
import { listMyTasks, listTaskProjects } from '@/lib/domain/tasks';
import Link from 'next/link';
import { MyTaskList } from './my/MyTaskList';

export default async function TaskHomePage() {
  const me = await getCurrentUser();
  const [tasks, projects] = await Promise.all([listMyTasks(me.id), listTaskProjects()]);
  const groups = groupMyTasksByDue(tasks, todayJst());
  const overdue = groups.find((g) => g.key === 'overdue')?.tasks.length ?? 0;
  const today = groups.find((g) => g.key === 'today')?.tasks.length ?? 0;
  // ホームには 期限切れ・今日・今後 7 日 だけ出す(全部はマイタスクで)
  const preview = groups.filter(
    (g) => g.key === 'overdue' || g.key === 'today' || g.key === 'week',
  );
  const hour = Number(new Date(Date.now() + 9 * 3600e3).toISOString().slice(11, 13));
  const greeting = hour < 11 ? 'おはようございます' : hour < 18 ? 'こんにちは' : 'こんばんは';

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">
          {greeting}、{me.full_name ?? me.email} さん
        </h1>
        <p className="text-sm text-muted-foreground">
          未完了 {tasks.length} 件
          {overdue > 0 && <span className="ml-2 text-red-700">期限切れ {overdue} 件</span>}
          {today > 0 && <span className="ml-2 text-amber-700">今日 {today} 件</span>}
        </p>
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">マイタスク</h2>
          <Link href="/task/my" className="sf-link text-xs">
            すべて表示
          </Link>
        </div>
        {preview.length === 0 ? (
          <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
            期日が近いタスクはありません
          </div>
        ) : (
          <MyTaskList groups={preview} />
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">参加プロジェクト</h2>
          <Link href="/task/projects" className="sf-link text-xs">
            一覧・作成
          </Link>
        </div>
        {projects.length === 0 ? (
          <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
            プロジェクトはありません
          </div>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/task/projects/${p.id}`}
                  className="flex items-center gap-3 rounded-lg border bg-card p-3 hover:bg-accent/40"
                >
                  <span
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-white"
                    style={{ backgroundColor: p.color ?? '#94a3b8' }}
                  >
                    {p.name.charAt(0)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{p.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      未完了 {p.open_count ?? 0} 件
                      {p.visibility === 'private' ? ' ・ メンバーのみ' : ''}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
