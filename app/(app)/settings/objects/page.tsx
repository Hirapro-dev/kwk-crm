/**
 * /settings/objects — オブジェクト管理 (Phase 1)
 *
 * 仕様書 §5.8 / §5.9 / §5.10。
 * オブジェクト一覧を表示し、各オブジェクトのフィールド管理画面 (/settings/objects/[id]) へ遷移する。
 *
 * Phase 1 の制約:
 *   - フィールドの表示/非表示・並び順を保存可能。
 *   - ただし、実画面のレンダリングはハードコードのまま (Phase 2 以降で動的化)。
 */

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { PanelHeader } from '@/components/layout/PanelHeader';
import { Card } from '@/components/ui/card';
import { listObjectDefinitions } from '@/lib/domain/object_metadata';

export default async function SettingsObjectsPage() {
  const objects = await listObjectDefinitions();

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel="OBJ"
          iconColor="#9333ea"
          viewName="オブジェクト管理"
          totalCount={objects.length}
        />
        <div className="px-4 py-3 text-xs text-muted-foreground">
          オブジェクトを選択するとフィールドの表示制御画面に移動します。
          <br />
          ※ Phase 1: 設定値の保存のみ。実画面への反映は今後対応予定。
        </div>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {objects.map((o) => (
          <Link key={o.id} href={`/settings/objects/${o.id}`}>
            <Card className="flex h-full items-center gap-3 p-4 transition-colors hover:bg-accent">
              <span
                className="sf-icon-chip"
                style={{ backgroundColor: o.icon_color ?? '#00C896' }}
                aria-hidden="true"
              >
                {o.icon_label ?? '???'}
              </span>
              <div className="flex-1">
                <h2 className="text-sm font-bold">{o.label}</h2>
                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{o.id}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
