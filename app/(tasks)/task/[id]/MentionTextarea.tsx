'use client';

import { Textarea } from '@/components/ui/textarea';
import { UserAvatar } from '@/components/users/UserAvatar';
import { useMemo, useRef, useState } from 'react';
import type { UserOption } from '../TaskBits';

/**
 * 「@」でユーザーを呼べるテキストエリア(migration 115)。
 * 「@」の直後(空白まで)を入力中は候補を出し、選ぶと「@氏名 」に置き換える。候補は氏名の部分一致(空白は無視)。
 * 呼ばれた人の記録は投稿時にサーバー側で本文から判定する(extractMentionUserIds)。
 */
export function MentionTextarea({
  value,
  onChange,
  users,
  placeholder,
  rows = 3,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  users: UserOption[];
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const [active, setActive] = useState(0);

  // キャレット直前の「@検索語」
  const query = useMemo(() => {
    if (caret === null) return null;
    const before = value.slice(0, caret);
    const m = before.match(/(?:^|[\s　])@([^\s　@]*)$/);
    return m ? { text: m[1] ?? '', start: caret - (m[1]?.length ?? 0) - 1 } : null;
  }, [value, caret]);
  const candidates = useMemo(() => {
    if (!query) return [];
    const q = query.text.replace(/[\s　]/g, '').toLowerCase();
    return users
      .filter((u) => (u.full_name ?? '').trim())
      .filter(
        (u) =>
          !q ||
          (u.full_name ?? '')
            .replace(/[\s　]/g, '')
            .toLowerCase()
            .includes(q),
      )
      .slice(0, 8);
  }, [users, query]);

  const pick = (u: UserOption) => {
    if (!query) return;
    const name = (u.full_name ?? '').trim();
    const next = `${value.slice(0, query.start)}@${name} ${value.slice(caret ?? value.length)}`;
    onChange(next);
    setCaret(null);
    const pos = query.start + name.length + 2;
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        value={value}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        className="text-sm"
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart);
          setActive(0);
        }}
        onClick={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
        onKeyUp={(e) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key))
            setCaret((e.target as HTMLTextAreaElement).selectionStart);
        }}
        onKeyDown={(e) => {
          if (!query || candidates.length === 0) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => (a + 1) % candidates.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => (a - 1 + candidates.length) % candidates.length);
          } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            const u = candidates[active];
            if (u) pick(u);
          } else if (e.key === 'Escape') {
            setCaret(null);
          }
        }}
        onBlur={() => setTimeout(() => setCaret(null), 150)}
      />
      {query && candidates.length > 0 && (
        <ul
          aria-label="呼ぶ相手の候補"
          className="absolute left-0 z-20 mt-1 max-h-56 w-72 overflow-y-auto rounded border bg-popover py-1 shadow-lg"
        >
          {candidates.map((u, i) => (
            <li key={u.id} data-active={i === active || undefined}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(u)}
                className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm ${i === active ? 'bg-accent' : 'hover:bg-accent/60'}`}
              >
                <UserAvatar name={u.full_name} avatarPath={u.avatar_path} size={22} />
                <span className="truncate">{u.full_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">
        「@」に続けて氏名を入力すると呼べます
      </p>
    </div>
  );
}
