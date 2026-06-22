/**
 * /settings/objects/[id]/layout-editor — レイアウトエディタ (Phase 2.5)
 *
 * - 一覧列の並び替え (DnD)
 * - 詳細レイアウトの編集 (セクション + フィールドの DnD)
 *
 * /settings/objects/[id] のフィールド管理画面とは別のタブ的扱い。
 * 上部にタブ式で「一覧」「詳細」を切替できる。
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { PanelHeader } from '@/components/layout/PanelHeader';
import { Card } from '@/components/ui/card';
import {
  getObjectDefinition,
  listFieldDefinitions,
} from '@/lib/domain/object_metadata';
import { LayoutEditorTabs } from './LayoutEditorTabs';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function LayoutEditorPage({ params }: PageProps) {
  const { id } = await params;
  const obj = await getObjectDefinition(id);
  if (!obj) notFound();

  // detail モードで取得 (sort_order_detail 順)。
  // 一覧側もこの配列から sort_order_list でソートし直す。
  const fields = await listFieldDefinitions(id, 'detail');

  return (
    <div className="space-y-3">
      <Link href={`/settings/objects/${obj.id}`} className="sf-back-link text-xs">
        ← {obj.label} のフィールド管理に戻る
      </Link>

      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel={obj.icon_label ?? '???'}
          iconColor={obj.icon_color ?? '#1589ee'}
          viewName={`${obj.label} のレイアウトエディタ`}
        />
        <div className="px-4 py-3 text-xs text-muted-foreground">
          ドラッグ &amp; ドロップで一覧の列順や詳細画面のフィールド配置を編集できます。
          <br />
          ※ 「一覧/詳細」のオン/オフは
          <Link
            href={`/settings/objects/${obj.id}`}
            className="text-primary hover:underline"
          >
            フィールド管理画面
          </Link>
          で設定してください。
        </div>
      </Card>

      <LayoutEditorTabs objectId={obj.id} allFields={fields} />
    </div>
  );
}
