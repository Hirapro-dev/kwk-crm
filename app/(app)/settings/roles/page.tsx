/**
 * /settings/roles — ロール管理 (admin 専用 / CLAUDE.md §5.10b)
 *
 * メニューバー項目ごとに「どのロールに表示するか」を設定する。
 * visible_roles が NULL(全ロール)の項目は「全ロール表示」トグルON として表示。
 * /settings 配下のため layout.tsx で admin チェック済 (二重チェックなし)。
 */

import { PanelHeader } from '@/components/layout/PanelHeader';
import { Card } from '@/components/ui/card';
import { getAllNavItems } from '@/lib/domain/nav_items';
import { RolesMatrix } from './RolesMatrix';

export default async function SettingsRolesPage() {
  const items = await getAllNavItems();

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel="ROL"
          iconColor="#7f5ae0"
          viewName="ロール管理(メニュー表示)"
          totalCount={items.length}
        />
        <div className="space-y-2 border-b px-4 py-3 text-xs text-muted-foreground">
          <p>
            メニューバーの各項目を、どのロールのユーザーに表示するかを設定します。
            「全ロール」ONの項目は全員に表示されます。OFFにするとロール別のチェックが有効になります。
          </p>
          <p>
            ※ 表示制御はメニューの表示のみです。データ自体のアクセス制御(RLS)は別途
            テーブル側で設定されています(出金管理は admin/manager/support のみ閲覧可)。
          </p>
        </div>
        <RolesMatrix items={items} />
      </Card>
    </div>
  );
}
