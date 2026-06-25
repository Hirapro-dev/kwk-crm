'use client';

import { Input } from '@/components/ui/input';
import { useEffect, useRef, useState } from 'react';

interface Props {
  /** 候補(個人情報取得ポイントのユニーク値) */
  options: string[];
  /** 選択中の値 */
  selected: string[];
  /** 選択変更時。新しい配列を返す */
  onChange: (next: string[]) => void;
}

/**
 * 個人情報取得ポイントの複数選択コンボボックス。
 * - 入力欄にフォーカスで全候補を表示、入力で絞り込み
 * - 候補クリックで追加(チップ表示)、チップの×で解除
 * - 「+ 追加」で連続追加が可能
 */
export function PointMultiSelect({ options, selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  const available = options.filter((o) => !selected.includes(o));
  const filtered = query.trim()
    ? available.filter((o) => o.toLowerCase().includes(query.trim().toLowerCase()))
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

  const add = (v: string) => {
    onChange([...selected, v]);
    setQuery('');
  };
  const remove = (v: string) => onChange(selected.filter((s) => s !== v));

  return (
    <div ref={wrapRef} className="relative w-full max-w-xl">
      {/* 選択済みチップ */}
      {selected.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
          {selected.map((s) => (
            <span
              key={s}
              className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-xs text-primary"
            >
              {s}
              <button
                type="button"
                onClick={() => remove(s)}
                className="text-primary/70 hover:text-primary"
                aria-label={`${s} を解除`}
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
          selected.length > 0 ? '+ 追加（名前で検索）' : '個人情報取得ポイントで検索（空欄で全件）'
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
              <li key={o}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    add(o);
                  }}
                  className="flex w-full items-center px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  {o}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
