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
      <TabsNav appName="対応歴管理" tabs={navTabs} />
      {/*
        Salesforce Lightning 風 背景:
          - 上部 約280px に lightning_blue_background.png を no-repeat で表示
          - その下のレイヤーは指定色 (#b0c4df) でベタ塗り
          - 画像とベタ塗りが地続きに見えるよう、background を 2 レイヤー重ねる
      */}
      <main
        className="relative flex-1 overflow-y-auto px-4 py-4"
        style={{
          backgroundColor: '#b0c4df',
          backgroundImage: 'url(/lightning_blue_background.png)',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'top center',
          backgroundSize: '100% 280px',
        }}
      >
        {children}
      </main>
    </div>
  );
}
