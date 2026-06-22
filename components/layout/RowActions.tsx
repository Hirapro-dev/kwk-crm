'use client';

import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/**
 * Salesforce Lightning リストビュー行の末尾に表示する ▼ アクションメニュー。
 *
 * 視覚は SLDS を再現するが、メニュー項目はオプション制。
 */
interface Props {
  items: { label: string; href?: string; onClick?: () => void; danger?: boolean }[];
}

export function RowActions({ items }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        aria-label="行アクション"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-1 min-w-[150px] rounded border bg-popover py-1 shadow-md"
        >
          {items.map((it, i) =>
            it.href ? (
              <a
                key={i}
                href={it.href}
                role="menuitem"
                className={`block px-3 py-1.5 text-xs ${
                  it.danger
                    ? 'text-destructive hover:bg-destructive/10'
                    : 'text-foreground hover:bg-accent'
                }`}
              >
                {it.label}
              </a>
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                onClick={() => {
                  it.onClick?.();
                  setOpen(false);
                }}
                className={`block w-full px-3 py-1.5 text-left text-xs ${
                  it.danger
                    ? 'text-destructive hover:bg-destructive/10'
                    : 'text-foreground hover:bg-accent'
                }`}
              >
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
