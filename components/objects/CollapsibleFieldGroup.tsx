'use client';

/**
 * 基本情報カード内の section_name グループ用アコーディオン。
 * 見出し(h3相当)をクリックで開閉する軽量版(Cardの枠は付けない)。
 */

import { cn } from '@/lib/utils/cn';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

export function CollapsibleFieldGroup({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mb-2 flex w-full items-center justify-between border-b pb-1 text-left"
      >
        <span className="text-sm font-bold tracking-wide text-slate-800">{title}</span>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-muted-foreground transition-transform',
            !open && '-rotate-90',
          )}
          aria-hidden="true"
        />
      </button>
      {open && children}
    </section>
  );
}
