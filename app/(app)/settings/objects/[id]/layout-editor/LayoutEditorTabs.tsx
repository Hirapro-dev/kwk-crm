'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils/cn';
import type { FieldDefinition } from '@/lib/domain/object_metadata';
import { DetailLayoutEditor } from './DetailLayoutEditor';
import { HighlightEditor } from './HighlightEditor';
import { ListColumnEditor } from './ListColumnEditor';

/**
 * レイアウトエディタの「詳細 / 一覧 / ハイライト」タブ切替 (Client Component)。
 */
interface Props {
  objectId: string;
  allFields: FieldDefinition[];
}

const TABS = [
  { id: 'detail',    label: '詳細レイアウト' },
  { id: 'list',      label: '一覧列' },
  { id: 'highlight', label: 'ハイライト' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function LayoutEditorTabs({ objectId, allFields }: Props) {
  const [active, setActive] = useState<TabId>('detail');

  return (
    <div className="space-y-3">
      <div className="flex items-stretch border-b bg-card rounded-t">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            onClick={() => setActive(tab.id)}
            className={cn(
              'border-b-[3px] px-5 py-2 text-sm transition-colors',
              active === tab.id
                ? 'border-primary font-bold text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {active === 'detail' && (
        <DetailLayoutEditor objectId={objectId} allFields={allFields} />
      )}
      {active === 'list' && <ListColumnEditor allFields={allFields} />}
      {active === 'highlight' && (
        <HighlightEditor objectId={objectId} allFields={allFields} />
      )}
    </div>
  );
}
