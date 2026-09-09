import { MAIL_TABS } from '@/lib/domain/mail_tabs';
import { cn } from '@/lib/utils/cn';
import Link from 'next/link';

/**
 * メーラー一覧の状態タブ(メールディーラーの「新着 / 返信処理中 / 対応完了 …」相当)。
 * 件数付き。タブ以外の条件(受信箱・担当・未読・件名)は URL のまま引き継ぐ。
 */
export function MailStatusTabs({
  current,
  counts,
  searchParams,
}: {
  current: string;
  counts: Record<string, number>;
  searchParams: { q?: string; assignee?: string; box?: string; unread?: string };
}) {
  const hrefFor = (key: string) => {
    const p = new URLSearchParams();
    if (key !== 'new') p.set('tab', key);
    if (searchParams.box) p.set('box', searchParams.box);
    if (searchParams.assignee) p.set('assignee', searchParams.assignee);
    if (searchParams.unread) p.set('unread', searchParams.unread);
    if (searchParams.q) p.set('q', searchParams.q);
    const qs = p.toString();
    return qs ? `/mail?${qs}` : '/mail';
  };

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b px-2 py-1.5">
      {MAIL_TABS.map((t, i) => {
        const active = t.key === current;
        const n = counts[t.key] ?? 0;
        // 通常分類のタブ群と、メルマガ以降の分類タブ群の間に仕切りを入れる
        const divider = i > 0 && MAIL_TABS[i - 1]?.category === '通常' && t.category !== '通常';
        return (
          <span key={t.key} className="flex items-center">
            {divider && <span className="mx-1 h-4 border-l" aria-hidden="true" />}
            <Link
              href={hrefFor(t.key)}
              className={cn(
                'flex items-center gap-1.5 whitespace-nowrap rounded px-2.5 py-1 text-xs',
                active
                  ? 'bg-primary/10 font-semibold text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
              aria-current={active ? 'page' : undefined}
            >
              {t.label}
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[10px] leading-none',
                  active && t.key === 'new' && n > 0
                    ? 'bg-orange-500 font-semibold text-white'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {n > 999 ? '999+' : n}
              </span>
            </Link>
          </span>
        );
      })}
    </div>
  );
}
