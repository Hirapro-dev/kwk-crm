/**
 * /settings/objects/[id] — フィールド管理画面
 *
 * 指定オブジェクトのフィールド一覧を表示し、
 * - 表示/非表示 (一覧 / 詳細別)
 * - ラベル変更
 * - 並び順変更
 * - 新規フィールド追加
 * - 削除 (is_system=false のみ)
 * を管理できる。
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { PanelHeader } from '@/components/layout/PanelHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  getObjectDefinition,
  listFieldDefinitions,
} from '@/lib/domain/object_metadata';
import { FieldEditor } from './FieldEditor';
import { NewFieldForm } from './NewFieldForm';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ObjectFieldsPage({ params }: PageProps) {
  const { id } = await params;
  const obj = await getObjectDefinition(id);
  if (!obj) notFound();

  const fields = await listFieldDefinitions(id, 'list');

  const systemCount = fields.filter((f) => f.is_system).length;
  const customCount = fields.filter((f) => f.is_custom).length;

  return (
    <div className="space-y-3">
      <Link href="/settings/objects" className="sf-back-link text-xs">
        ← オブジェクト管理へ戻る
      </Link>

      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel={obj.icon_label ?? '???'}
          iconColor={obj.icon_color ?? '#1589ee'}
          viewName={`${obj.label} のフィールド管理`}
          actions={
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {fields.length} フィールド (システム: {systemCount} / カスタム: {customCount})
              </span>
              <Link href={`/settings/objects/${obj.id}/layout-editor`}>
                <Button size="sm" variant="outline">
                  レイアウトエディタを開く
                </Button>
              </Link>
            </div>
          }
        />
        <div className="px-4 py-3 text-xs text-muted-foreground">
          各フィールドの表示/非表示、ラベル、並び順を管理できます。
          <br />
          並び順や詳細セクションをドラッグ&amp;ドロップで編集するには「レイアウトエディタを開く」をご利用ください。
        </div>
      </Card>

      <NewFieldForm objectId={obj.id} />

      <FieldEditor fields={fields} />
    </div>
  );
}
