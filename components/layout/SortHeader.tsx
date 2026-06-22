'use client';

/**
 * 一覧の列ヘッダー用 昇順/降順ソートボタン。
 * URL クエリ(?sort=列&dir=asc|desc)を更新し、サーバー側で並び替える。
 * 他のクエリ(検索・フィルタ)は保持し、ページは1に戻す。
 */

import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils/cn';

export function SortHeader({
  field,
  label,
  className,
}: {
  field: string;
  label: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const curSort = params.get('sort');
  const curDir = params.get('dir') === 'desc' ? 'desc' : 'asc';
  const active = curSort === field;
  const nextDir = active && curDir === 'asc' ? 'desc' : 'asc';

  const onClick = () => {
    const sp = new URLSearchParams(params.toString());
    sp.set('sort', field);
    sp.set('dir', nextDir);
    sp.set('page', '1');
    router.push(`${pathname}?${sp.toString()}`);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 text-left hover:text-foreground',
        active ? 'font-bold text-foreground' : '',
        className,
      )}
      title={`${label} で並び替え`}
    >
      <span className="truncate">{label}</span>
      {active ? (
        curDir === 'asc' ? (
          <ArrowUp className="h-3 w-3 shrink-0" />
        ) : (
          <ArrowDown className="h-3 w-3 shrink-0" />
        )
      ) : (
        <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-30" />
      )}
    </button>
  );
}
