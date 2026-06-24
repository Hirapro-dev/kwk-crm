/**
 * 認証後のアプリケーション共通レイアウト。
 *
 * Salesforce Lightning Experience 風の2段ヘッダー:
 *   1. 濃紺ヘッダーバー (Topbar)
 *   2. 横タブナビゲーション (TabsNav)
 * その下にメインコンテンツを配置する。
 *
 * 仕様書 §8.1 のページ一覧に従いナビゲーションを構成する。
 */

import { BottomNav } from '@/components/layout/BottomNav';
import { TabsNav } from '@/components/layout/TabsNav';
import { Topbar } from '@/components/layout/Topbar';
import { getVisibleNavTabs } from '@/lib/domain/nav_items';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // メニューバーの並び・表示は nav_items マスタから取得 (管理者が /settings/navigation で編集)。
  // 未適用時は既定リストにフォールバック。仕様書 §5.10b / §8.1。
  const navTabs = await getVisibleNavTabs();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Topbar />
      {/* PC: 横タブナビ / モバイル: 非表示 */}
      <div className="hidden md:block">
        <TabsNav appName="対応歴管理" tabs={navTabs} />
      </div>
      {/*
        背景: lightning_blue_background.png を上部に表示、背景色 #f0fffd
        モバイルではボトムナビ分 (pb-16) のパディングを追加
      */}
      <main
        className="relative flex-1 overflow-y-auto px-4 py-4 pb-20 md:pb-4"
        style={{
          backgroundColor: '#f0fffd',
          backgroundImage: 'url(/lightning_blue_background.png)',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'top center',
        }}
      >
        {children}
      </main>
      {/* モバイル専用ボトムナビ */}
      <BottomNav tabs={navTabs} />
    </div>
  );
}
