'use client';

/**
 * 基本情報カード内の section_name グループ用アコーディオン。
 * 見出し(h3相当)をクリックで開閉する軽量版(Cardの枠は付けない)。
 * `expand-all-fieldgroups` / `collapse-all-fieldgroups` カスタムイベントに応答する。
 */

import { cn } from '@/lib/utils/cn';
import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';

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

  useEffect(() => {
    const expand = () => setOpen(true);
    const collapse = () => setOpen(false);
    window.addEventListener('expand-all-fieldgroups', expand);
    window.addEventListener('collapse-all-fieldgroups', collapse);
    return () => {
      window.removeEventListener('expand-all-fieldgroups', expand);
      window.removeEventListener('collapse-all-fieldgroups', collapse);
    };
  }, []);

  return (
    <section className="rounded-md overflow-hidden border border-slate-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between bg-slate-100 px-3 py-2 text-left hover:bg-slate-200 transition-colors"
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">{title}</span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 text-slate-400 transition-transform duration-200',
            !open && '-rotate-90',
          )}
          aria-hidden="true"
        />
      </button>
      {open && <div className="min-w-0 overflow-hidden bg-white p-3">{children}</div>}
    </section>
  );
}
