'use client';

import type { TaskUserFolderSection } from '@/lib/domain/task_pure';
import { TASK_SW_SCOPE, TASK_SW_URL } from '@/lib/domain/task_push';
import type { AppUser } from '@/lib/domain/types';
import { cn } from '@/lib/utils/cn';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { TaskMobileTabBar } from './TaskMobileTabBar';
import { type SidebarProject, TaskSidebar } from './TaskSidebar';
import { TaskTopbar } from './TaskTopbar';

/**
 * タスク管理の枠(ヘッダー + 左メニュー + 本文)。左メニューの開閉をここで持つ(§8.1。2026-09-22)。
 * - PC(md 以上): ヘッダーのメニューボタンで左メニューを畳む/出す。状態は端末ごとにブラウザへ記憶する
 * - スマホ(md 未満): 左メニューは普段は出さず、下タブ(TaskMobileTabBar)の「メニュー」で本文の上に重ねて開く(背景タップか画面遷移で閉じる)
 */
const STORAGE_KEY = 'task-sidebar-collapsed';

export function TaskShell({
  me,
  projects,
  folders,
  canCreate,
  unreadMentions,
  children,
}: {
  me: AppUser;
  projects: SidebarProject[];
  folders: TaskUserFolderSection<SidebarProject>[];
  canCreate: boolean;
  /** 受信トレイの未読メンション数(バッジ) */
  unreadMentions: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // 初期表示はサーバーと同じ「開いた状態」で描画し、マウント後に記憶を反映する(表示のずれを防ぐ)
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === '1');
    } catch {
      /* private mode など。既定のまま */
    }
  }, []);
  // プッシュ通知用の Service Worker(migration 116)。登録だけ行い、購読は「通知の設定」で本人が行う。
  // 範囲(scope)はマニフェスト(/manifest-task.json)と同じ /task に揃える。iPhone のホーム画面アプリは
  // マニフェストの範囲と Service Worker の範囲が食い違うと通知を表示しないことがあるため(2026-09-22)。
  // 以前のサイト全体(/)の登録が残っていれば外す(その登録に付いていた購読は無効になるので、設定画面で登録し直す)
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    (async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) {
          if (new URL(r.scope).pathname === '/') await r.unregister();
        }
        await navigator.serviceWorker.register(TASK_SW_URL, { scope: TASK_SW_SCOPE });
      } catch {
        /* 非対応ブラウザなど。通知以外の機能には影響しない */
      }
    })();
  }, []);
  // 画面遷移したらスマホの重ねメニューは閉じる
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname の変化だけを見る
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const toggle = () => {
    // md 以上なら畳む/出す、md 未満なら重ねて開く/閉じる
    if (window.matchMedia('(min-width: 768px)').matches) {
      setCollapsed((c) => {
        const next = !c;
        try {
          localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
        } catch {
          /* 記憶できなくても動作は変わらない */
        }
        return next;
      });
    } else {
      setMobileOpen((o) => !o);
    }
  };

  return (
    <div className="flex h-dvh flex-col bg-background">
      <TaskTopbar me={me} onMenuClick={toggle} />
      <div className="relative flex min-h-0 flex-1">
        {/* スマホ: 重ねメニューの背景(タップで閉じる) */}
        {mobileOpen && (
          <button
            type="button"
            aria-label="メニューを閉じる"
            className="fixed inset-0 top-12 z-30 bg-black/30 md:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}
        <div
          className={cn(
            'z-40 md:static md:z-auto',
            mobileOpen ? 'fixed bottom-14 left-0 top-12 flex' : 'hidden',
            collapsed ? 'md:hidden' : 'md:flex',
          )}
        >
          <TaskSidebar
            projects={projects}
            folders={folders}
            canCreate={canCreate}
            unreadMentions={unreadMentions}
          />
        </div>
        <main className="min-w-0 flex-1 overflow-y-auto bg-[#f7f8fa] p-3 pb-20 md:p-4">
          {children}
        </main>
      </div>
      <TaskMobileTabBar
        onMenuClick={() => setMobileOpen((o) => !o)}
        menuOpen={mobileOpen}
        unreadMentions={unreadMentions}
      />
    </div>
  );
}
