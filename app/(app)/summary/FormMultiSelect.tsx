'use client';

import { Input } from '@/components/ui/input';
import { useEffect, useRef, useState } from 'react';

export interface FormOption {
  id: number;
  name: string;
}

interface Props {
  options: FormOption[];
  /** 選択中のフォームID */
  selected: number[];
  onChange: (next: number[]) => void;
}

/**
 * フォーム複数選択コンボボックス。
 * - フォーカスで全フォーム表示、入力で絞り込み
 * - 選択でチップ追加(+追加で複数可)、×で解除
 */
export function FormMultiSelect({ options, selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  const byId = new Map(options.map((o) => [o.id, o.name]));
  const available = options.filter((o) => !selected.includes(o.id));
  const filtered = query.trim()
    ? available.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase()))
    : available;

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const add = (id: number) => {
    onChange([...selected, id]);
    setQuery('');
  };
  const remove = (id: number) => onChange(selected.filter((s) => s !== id));

  return (
    <div ref={wrapRef} className="relative w-full max-w-xl">
      {selected.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
          {selected.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-xs text-primary"
            >
              {byId.get(id) ?? `#${id}`}
              <button
                type="button"
                onClick={() => remove(id)}
                className="text-primary/70 hover:text-primary"
                aria-label="解除"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <Input
        value={query}
        placeholder={
          selected.length > 0 ? '+ 追加（フォーム名で検索）' : 'フォーム名で検索（空欄で全件）'
        }
        onFocus={() => {
          setOpen(true);
          setQuery('');
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
        }}
      />

      {open && (
        <ul className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-md border bg-background shadow-lg">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">該当なし</li>
          ) : (
            filtered.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    add(o.id);
                  }}
                  className="flex w-full items-center px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  {o.name}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
