'use client';

/**
 * 見出しクリックで開閉するセクション(アコーディオン)。
 * スマホで会員詳細が縦長になり対応歴登録がしにくい問題への対応。
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
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between bg-slate-600 px-4 py-2.5 text-left hover:bg-slate-500 transition-colors"
      >
        <span className="text-sm font-semibold tracking-wide text-white">{title}</span>
        <span className="flex items-center gap-2">
          {count != null && (
            <span className="text-xs text-slate-300">{count.toLocaleString()}件</span>
          )}
          <ChevronDown
            className={cn('h-4 w-4 text-slate-300 transition-transform duration-200', !open && '-rotate-90')}
            aria-hidden="true"
          />
        </span>
      </button>
      {open && <div className={bodyClassName}>{children}</div>}
    </Card>
  );
}
