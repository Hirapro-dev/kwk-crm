import Link from 'next/link';

/**
 * サイドナビ(仕様書 §8.1 ページ一覧)
 * Phase 0 雛形: 静的リンクのみ。アクティブ判定・shadcn/ui 化は Phase 4。
 */
const NAV_ITEMS: { href: string; label: string }[] = [
  { href: '/', label: 'ダッシュボード' },
  { href: '/activities', label: '活動履歴' },
  { href: '/members', label: '会員' },
  { href: '/inquiries', label: '問合せ' },
  { href: '/applications', label: '申込' },
  { href: '/projects', label: '案件マスタ' },
  { href: '/reports', label: 'レポート' },
  { href: '/admin/users', label: '管理: ユーザー' },
];

export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 border-r bg-card md:flex md:flex-col">
      <div className="flex h-14 items-center border-b px-4">
        <Link href="/" className="text-base font-semibold">
          ひらプロCRM
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="block rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
