/**
 * タスク管理(/task 配下)の共通レイアウト(仕様書 §5.20 / §8.1)。
 *
 * メーラー(app/(mailer))と同じく CRM 本体の Topbar/TabsNav は出さず、Asana 風の
 * 「上: 黒ヘッダー / 左: メニュー(ホーム・マイタスク・参加プロジェクト) / 右: 一覧」構成にする。
 * ヘッダーのタスクアイコンとアプリランチャーから別タブで開く。認証は middleware + getCurrentUser で CRM 本体と同じ。
 */

import { getCurrentUser } from '@/lib/domain/auth';
import { listTaskProjects } from '@/lib/domain/tasks';
import { TaskSidebar } from './TaskSidebar';
import { TaskTopbar } from './TaskTopbar';

export default async function TasksLayout({ children }: { children: React.ReactNode }) {
  const [me, projects] = await Promise.all([getCurrentUser(), listTaskProjects()]);
  return (
    <div className="flex h-dvh flex-col bg-background">
      <TaskTopbar me={me} />
      <div className="flex min-h-0 flex-1">
        <TaskSidebar
          projects={projects.map((p) => ({
            id: p.id,
            name: p.name,
            color: p.color,
            visibility: p.visibility,
          }))}
          canCreate={me.role !== 'viewer'}
        />
        <main className="min-w-0 flex-1 overflow-y-auto bg-[#f7f8fa] p-4">{children}</main>
      </div>
    </div>
  );
}
