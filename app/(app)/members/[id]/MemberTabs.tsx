'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * Salesforce Lightning 風 Record Page の上部タブ (詳細/関連)。
 *
 * 2026-05 更新: 活動操作は詳細タブ右カラムに集約したため「活動」タブを削除。
 *
 * 単純な showTab state で表示切替する Client Component。
 * 各タブのコンテンツは Server Component から children に分けて受け取る。
 */
interface Props {
  detailsContent: React.ReactNode;
  relatedContent: React.ReactNode;
}

const TABS = [
  { id: 'details', label: '詳細' },
  { id: 'related', label: '関連' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function MemberTabs({ detailsContent, relatedContent }: Props) {
  const [active, setActive] = useState<TabId>('details');

  return (
    <div className="rounded border bg-card shadow-sm">
      <div className="flex items-stretch border-b">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            onClick={() => setActive(tab.id)}
            className={cn(
              'border-b-[3px] px-5 py-2.5 text-sm transition-colors',
              active === tab.id
                ? 'border-primary font-bold text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="p-4">
        {active === 'details' && detailsContent}
        {active === 'related' && relatedContent}
      </div>
    </div>
  );
}
