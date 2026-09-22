/**
 * タスク管理(/task 配下)の共通レイアウト(仕様書 §5.20 / §8.1)。
 *
 * メーラー(app/(mailer))と同じく CRM 本体の Topbar/TabsNav は出さず、Asana 風の
 * 「上: 黒ヘッダー / 左: メニュー(ホーム・マイタスク・マイフォルダ・参加プロジェクト) / 右: 一覧」構成にする。
 * 左メニューの開閉(PC は畳む、スマホは重ねて開く)は TaskShell(client)が持つ(2026-09-22)。
 * ヘッダーのタスクアイコンとアプリランチャーから別タブで開く。認証は middleware + getCurrentUser で CRM 本体と同じ。
 */

import { getCurrentUser } from '@/lib/domain/auth';
import { taskUserFolderSections } from '@/lib/domain/task_pure';
import { countMyUnreadMentions, listMyTaskUserFolders, listTaskProjects } from '@/lib/domain/tasks';
import type { Metadata } from 'next';
import { TaskShell } from './TaskShell';

/** タスク管理は別の PWA として「ホーム画面に追加」できる(start_url /task。プッシュ通知は iPhone ではこの状態が必要) */
export const metadata: Metadata = {
  title: 'ひらプロタスク',
  manifest: '/manifest-task.json',
  appleWebApp: { capable: true, title: 'ひらプロタスク', statusBarStyle: 'black' },
};

export default async function TasksLayout({ children }: { children: React.ReactNode }) {
  const [me, projects, userFolders, unreadMentions] = await Promise.all([
    getCurrentUser(),
    listTaskProjects(),
    listMyTaskUserFolders(),
    countMyUnreadMentions(),
  ]);
  const sidebarProjects = projects.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    visibility: p.visibility,
  }));
  // マイフォルダ(migration 110)。閲覧できるプロジェクトだけを載せる
  const folders = taskUserFolderSections(sidebarProjects, userFolders);
  return (
    <TaskShell
      me={me}
      projects={sidebarProjects}
      folders={folders}
      canCreate={me.role !== 'viewer'}
      unreadMentions={unreadMentions}
    >
      {children}
    </TaskShell>
  );
}
