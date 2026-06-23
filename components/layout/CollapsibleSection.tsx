'use client';

/**
 * 見出しクリックで開閉するセクション(アコーディオン)。
 * スマホで会員詳細が縦長になり活動登録がしにくい問題への対応。
 * 既定は開いた状態。閉じると本文を非表示にする。
 */

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils/cn';

export function CollapsibleSection({
  title,
  count,
  defaultOpen = true,
  bodyClassName = 'p-4',
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between border-b px-4 py-3 text-left hover:bg-accent/30"
      >
        <span className="text-sm font-bold">{title}</span>
        <span className="flex items-center gap-2">
          {count != null && (
            <span className="text-xs text-muted-foreground">{count.toLocaleString()}件</span>
          )}
          <ChevronDown
            className={cn('h-4 w-4 text-muted-foreground transition-transform', !open && '-rotate-90')}
            aria-hidden="true"
          />
        </span>
      </button>
      {open && <div className={bodyClassName}>{children}</div>}
    </Card>
  );
}
