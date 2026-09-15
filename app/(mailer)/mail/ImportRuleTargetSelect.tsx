'use client';

import {
  FORM_TARGET,
  type FilteredTargetOptions,
  type InquiryFieldOption,
  type TargetOption,
  type TargetOptions,
  buildTargetOptions,
  filterTargetOptions,
  targetLabel,
} from '@/lib/domain/mail_import_targets';
import { ChevronDown, Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

/**
 * 取込ルールの「入れる項目」セレクト(CLAUDE.md §5.16)。
 * 取込候補のメール詳細の「取込ルール」パネルと、/mail/settings の編集ダイアログの両方で使う。
 * 問合せの可変項目が 289 件あるため、文字で絞り込めるセレクト(検索欄付きのプルダウン)にする。
 * 選択肢の組み立てと絞り込みは純粋関数(lib/domain/mail_import_targets.ts)。
 */

export { FORM_TARGET, buildTargetOptions, targetLabel };
export type { InquiryFieldOption, TargetOptions };

export const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

interface Props {
  /** 本文のラベル(「可変項目(新規)」の候補名になる) */
  label: string;
  value: string;
  onChange: (target: string) => void;
  options: TargetOptions;
  disabled?: boolean;
}

const NONE: TargetOption = { value: '', label: '(入れない)' };

/** 絞り込み結果を、上から順に選べる1本のリストにする(Enter で先頭を選ぶため) */
function flatten(f: FilteredTargetOptions, current: TargetOption | null): TargetOption[] {
  return [
    NONE,
    ...(current ? [current] : []),
    ...(f.form ? [f.form] : []),
    ...f.columns,
    ...f.extras,
    ...(f.newExtra ? [f.newExtra] : []),
  ];
}

export function ImportRuleTargetSelect({ label, value, onChange, options, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const filtered = useMemo(
    () => filterTargetOptions(options, query, label),
    [options, query, label],
  );
  // 既存ルールが未定義の可変項目を指しているときも、その値を選べるようにする
  const knownValues = useMemo(
    () =>
      new Set([
        FORM_TARGET,
        ...options.columns.map((c) => c.value),
        ...options.extras.map((e) => e.value),
        `extra:${label}`,
      ]),
    [options, label],
  );
  const current: TargetOption | null =
    value !== '' && !knownValues.has(value) ? { value, label: targetLabel(options, value) } : null;
  const items = flatten(filtered, current);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  // 外側クリックで閉じる
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const pick = (target: string) => {
    onChange(target);
    close();
  };

  const groups: Array<{ title: string; items: TargetOption[] }> = [
    ...(current ? [{ title: '現在の設定', items: [current] }] : []),
    {
      title: '問合せの項目',
      items: [...(filtered.form ? [filtered.form] : []), ...filtered.columns],
    },
    { title: '可変項目(定義済み)', items: filtered.extras },
    { title: '可変項目(新規)', items: filtered.newExtra ? [filtered.newExtra] : [] },
  ].filter((g) => g.items.length > 0);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={`${selectClass} flex items-center justify-between text-left disabled:cursor-not-allowed disabled:opacity-50`}
        onClick={() => (open ? close() : setOpen(true))}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
      >
        <span className={`truncate ${value === '' ? 'text-muted-foreground' : ''}`}>
          {value === '' ? NONE.label : targetLabel(options, value)}
        </span>
        <ChevronDown className="ml-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-full min-w-[280px] rounded-md border bg-popover text-popover-foreground shadow-md">
          <div className="flex items-center gap-1 border-b px-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  close();
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  // 検索語があるときは先頭の一致項目、無いときは何もしない(誤って「入れない」にしないため)
                  const first = items.find((i) => i.value !== '' && i.value !== current?.value);
                  if (query !== '' && first) pick(first.value);
                }
              }}
              placeholder="項目名で絞り込み(例: 銘柄)"
              className="h-8 w-full bg-transparent text-xs focus:outline-none"
              aria-label="項目名で絞り込み"
            />
          </div>
          <ul id={listId} className="max-h-64 overflow-y-auto py-1 text-xs" aria-label="入れる項目">
            <li>
              <button
                type="button"
                className={`w-full px-2 py-1 text-left hover:bg-accent ${value === '' ? 'font-semibold' : 'text-muted-foreground'}`}
                onClick={() => pick('')}
              >
                {NONE.label}
              </button>
            </li>
            {groups.map((g) => (
              <li key={g.title}>
                <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold text-muted-foreground">
                  {g.title}
                </div>
                <ul>
                  {g.items.map((i) => (
                    <li key={i.value}>
                      <button
                        type="button"
                        className={`w-full truncate px-2 py-1 text-left hover:bg-accent ${i.value === value ? 'bg-accent/60 font-semibold' : ''}`}
                        onClick={() => pick(i.value)}
                        title={i.label}
                      >
                        {g.title === '可変項目(新規)'
                          ? `「${i.label}」を新しい可変項目として追加`
                          : i.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
            {groups.length === 0 && (
              <li className="px-2 py-2 text-muted-foreground">該当する項目がありません</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
