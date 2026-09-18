'use client';

import { cn } from '@/lib/utils/cn';
import { CheckCircle2, FolderKanban, Home, Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * タスク管理の左メニュー(Asana 風。§8.1)。ホーム / マイタスク / 参加プロジェクト(閲覧できるプロジェクトの一覧)。
 */
interface Props {
  projects: Array<{
    id: number;
    name: string;
    color: string | null;
    visibility: 'public' | 'private';
  }>;
  canCreate: boolean;
}

export function TaskSidebar({ projects, canCreate }: Props) {
  const pathname = usePathname();
  const item = (href: string, label: string, icon: React.ReactNode, exact = false) => {
    const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
    return (
      <Link
        href={href}
        className={cn(
          'flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-black/5',
          active ? 'bg-black/10 font-medium' : 'text-foreground/90',
        )}
      >
        {icon}
        {label}
      </Link>
    );
  };
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r bg-[#eef0f3]">
      <nav className="space-y-0.5 p-2">
        {item('/task', 'ホーム', <Home className="h-4 w-4" />, true)}
        {item('/task/my', 'マイタスク', <CheckCircle2 className="h-4 w-4" />)}
      </nav>
      <div className="mt-2 flex items-center justify-between px-3">
        <Link
          href="/task/projects"
          className="text-xs font-semibold text-muted-foreground hover:underline"
        >
          参加プロジェクト
        </Link>
        {canCreate && (
          <Link
            href="/task/projects?new=1"
            className="rounded p-0.5 text-muted-foreground hover:bg-black/10"
            title="プロジェクトを作成"
          >
            <Plus className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
        {projects.length === 0 && (
          <p className="px-2 text-xs text-muted-foreground">プロジェクトはありません</p>
        )}
        {projects.map((p) => {
          const href = `/task/projects/${p.id}`;
          const active = pathname === href;
          return (
            <Link
              key={p.id}
              href={href}
              className={cn(
                'flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-black/5',
                active ? 'bg-black/10 font-medium' : 'text-foreground/90',
              )}
              title={p.name}
            >
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: p.color ?? '#94a3b8' }}
              />
              <span className="truncate">{p.name}</span>
              {p.visibility === 'private' && (
                <FolderKanban
                  className="ml-auto h-3 w-3 shrink-0 opacity-50"
                  aria-label="メンバーのみ"
                />
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
