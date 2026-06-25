'use client';

import { Input } from '@/components/ui/input';
import { useEffect, useRef, useState } from 'react';

export interface UserOption {
  id: string;
  full_name: string | null;
}

interface Props {
  users: UserOption[];
  /** 選択中の users.id (未選択は null/空) */
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
}

/**
 * ユーザー検索コンボボックス。
 * - フォーカス時: 全ユーザーを下に表示
 * - 入力時: 名前で絞り込み
 * - 選択するとその id を onChange で通知
 * - 「(なし)」で選択解除
 */
export function UserCombobox({ users, value, onChange, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  const selected = users.find((u) => u.id === value) ?? null;
  const selectedLabel = selected?.full_name ?? '';

  // 開いている間は入力テキスト、閉じているときは選択名を表示
  const inputValue = open ? query : selectedLabel;

  const filtered = query.trim()
    ? users.filter((u) => (u.full_name ?? '').toLowerCase().includes(query.trim().toLowerCase()))
    : users;

  // 外側クリックで閉じる
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

  const handleSelect = (id: string | null) => {
    onChange(id);
    setOpen(false);
    setQuery('');
  };

  return (
    <div ref={wrapRef} className="relative">
      <Input
        value={inputValue}
        placeholder={placeholder ?? '名前で検索'}
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
          <li>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(null);
              }}
              className="flex w-full items-center px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent"
            >
              (なし)
            </button>
          </li>
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">該当者なし</li>
          ) : (
            filtered.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelect(u.id);
                  }}
                  className={`flex w-full items-center px-3 py-2 text-left text-sm hover:bg-accent ${
                    u.id === value ? 'bg-accent/50 font-medium' : ''
                  }`}
                >
                  {u.full_name ?? u.id}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
