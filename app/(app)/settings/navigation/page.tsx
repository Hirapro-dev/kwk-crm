/**
 * メニューバー(ナビゲーション)設定ページ (admin 限定 / CLAUDE.md §5.10b)
 *
 * 上部横タブの並び順・表示ON/OFF を管理者が変更する。
 * /settings レイアウトで admin チェック済み。
 */

import { getAllNavItems } from '@/lib/domain/nav_items';
import { NavEditor } from './NavEditor';

export default async function NavigationSettingsPage() {
  const items = await getAllNavItems();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">メニューバー設定</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          画面上部のメニュー(タブ)の並び順と表示/非表示を変更します。設定はシステム全体に適用されます。
        </p>
      </div>
      <NavEditor items={items} />
    </div>
  );
}
