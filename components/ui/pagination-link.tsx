import Link from 'next/link';
import { cn } from '@/lib/utils/cn';

/**
 * 一覧ページ共通のページネーションUI。
 * Server Component から呼び出して disabled でも見た目を維持する。
 */
export function PaginationBar({
  page,
  pageSize,
  total,
  basePath,
  searchParams,
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  /** 現在のクエリパラメータ(page を除いて引き継ぐ) */
  searchParams: Record<string, string | undefined>;
}) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  if (lastPage <= 1) return null;

  const build = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (v && k !== 'page') params.set(k, v);
    }
    params.set('page', String(p));
    return `${basePath}?${params.toString()}`;
  };

  const linkClass = (disabled: boolean) =>
    cn(
      'inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-3 text-sm transition-colors',
      disabled
        ? 'pointer-events-none opacity-50'
        : 'hover:bg-accent hover:text-accent-foreground',
    );

  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">
        {page} / {lastPage} ページ ({total.toLocaleString()} 件)
      </span>
      <div className="flex gap-2">
        <Link href={build(Math.max(1, page - 1))} className={linkClass(page <= 1)}>
          前へ
        </Link>
        <Link href={build(Math.min(lastPage, page + 1))} className={linkClass(page >= lastPage)}>
          次へ
        </Link>
      </div>
    </div>
  );
}
