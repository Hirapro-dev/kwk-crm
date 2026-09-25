'use client';

/**
 * 旧社債管理 一覧の検索・フィルタ・並び替え(CLAUDE.md §5.13c)。
 * URL クエリ(q / bond / result / from / to / sort / dir)を更新し、サーバー側で絞り込み・並び替える。
 * 並び替えは列見出しのクリック(SortHeader)と同じ ?sort= / ?dir= を使う。
 */

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { LEGACY_BOND_RESULT_NONE, LEGACY_BOND_SORT_OPTIONS } from '@/lib/domain/legacy_bonds_pure';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

interface Props {
  initial: {
    q: string;
    bond: string;
    result: string;
    from: string;
    to: string;
    sort: string;
    dir: 'asc' | 'desc';
  };
  bondNames: string[];
  results: string[];
}

/** "2025/08" → <input type="month"> の "2025-08" */
function toMonthInput(v: string): string {
  return v.replace('/', '-');
}

export function LegacyBondsFilterBar({ initial, bondNames, results }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(initial.q);
  const [bond, setBond] = useState(initial.bond);
  const [result, setResult] = useState(initial.result);
  const [from, setFrom] = useState(toMonthInput(initial.from));
  const [to, setTo] = useState(toMonthInput(initial.to));
  const [sort, setSort] = useState(initial.sort);
  const [dir, setDir] = useState<'asc' | 'desc'>(initial.dir);

  const submit = () => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (bond) params.set('bond', bond);
    if (result) params.set('result', result);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (sort) {
      params.set('sort', sort);
      params.set('dir', dir);
    }
    startTransition(() => router.push(`/legacy-bonds${params.size ? `?${params}` : ''}`));
  };

  const clear = () => {
    setQ('');
    setBond('');
    setResult('');
    setFrom('');
    setTo('');
    setSort('');
    setDir('desc');
    startTransition(() => router.push('/legacy-bonds'));
  };

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="min-w-[220px] flex-1">
        <Input
          placeholder="旧社債管理ID・会員ID・会員氏名・申込ID・社債名・今回の結果で検索"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <Select
        className="w-60"
        value={bond}
        onChange={(e) => setBond(e.target.value)}
        aria-label="社債名"
      >
        <option value="">社債名: すべて</option>
        {bondNames.map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
      </Select>
      <Select
        className="w-44"
        value={result}
        onChange={(e) => setResult(e.target.value)}
        aria-label="今回の結果"
      >
        <option value="">今回の結果: すべて</option>
        {results.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
        <option value={LEGACY_BOND_RESULT_NONE}>(未入力)</option>
      </Select>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span>償還対象月</span>
        <Input
          type="month"
          className="w-36"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          aria-label="償還対象月(から)"
        />
        <span>〜</span>
        <Input
          type="month"
          className="w-36"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          aria-label="償還対象月(まで)"
        />
      </div>
      <div className="flex items-center gap-1">
        <Select
          className="w-40"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          aria-label="並び替え"
        >
          <option value="">並び替え: 既定</option>
          {LEGACY_BOND_SORT_OPTIONS.map((o) => (
            <option key={o.field} value={o.field}>
              {o.label}
            </option>
          ))}
        </Select>
        <Select
          className="w-24"
          value={dir}
          onChange={(e) => setDir(e.target.value === 'asc' ? 'asc' : 'desc')}
          disabled={!sort}
          aria-label="並び順"
        >
          <option value="desc">降順</option>
          <option value="asc">昇順</option>
        </Select>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? '検索中…' : '検索'}
      </Button>
      <Button type="button" variant="outline" onClick={clear}>
        クリア
      </Button>
    </form>
  );
}
