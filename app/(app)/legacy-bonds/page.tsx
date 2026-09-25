/**
 * 旧社債管理 一覧画面(CLAUDE.md §5.13c / §8.1)
 *
 * 旧社債の継続・償還の管理行(1 行 = 1 償還対象月の 1 申込)を一覧表示する。閲覧は admin のみ(RLS でも制限)。
 * 一覧カラムはオブジェクト管理(/settings/objects/legacy_bonds)の設定に従う。表示は無限スクロール。
 */

import { LegacyBondsInfinite } from '@/components/legacy_bonds/LegacyBondsInfinite';
import { Card } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/domain/auth';
import { listLegacyBonds } from '@/lib/domain/legacy_bonds';
import { LIST_PAGE_SIZE } from '@/lib/domain/list_constants';
import { getVisibleFields } from '@/lib/domain/object_metadata';
import Link from 'next/link';

interface PageProps {
  searchParams: Promise<{ q?: string; sort?: string; dir?: string }>;
}

export default async function LegacyBondsPage({ searchParams }: PageProps) {
  const me = await getCurrentUser();
  if (me.role !== 'admin') {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        このページを表示する権限がありません。
      </p>
    );
  }

  const sp = await searchParams;
  const dir = sp.dir === 'asc' ? 'asc' : 'desc';
  const [result, listFields] = await Promise.all([
    listLegacyBonds({ q: sp.q, sort: sp.sort, dir, page: 1, pageSize: LIST_PAGE_SIZE }),
    getVisibleFields('legacy_bonds', 'list'),
  ]);
  const listKey = `${sp.q ?? ''}|${sp.sort ?? ''}|${dir}`;

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0 shadow-sm">
        <div className="flex items-start justify-between border-b px-4 py-3">
          <div className="flex items-center gap-3">
            <span
              className="sf-icon-chip"
              style={{ backgroundColor: '#8a5ae0' }}
              aria-hidden="true"
            >
              BND
            </span>
            <div className="flex flex-col">
              <h1 className="text-base font-bold text-foreground">旧社債管理</h1>
              <span className="text-xs text-muted-foreground">
                {result.total.toLocaleString()} 件
              </span>
            </div>
          </div>
        </div>

        {/* 検索帯(旧社債管理ID / 会員ID / 会員氏名 / 申込ID / 社債名 / 今回の結果 を部分一致) */}
        <div className="border-b px-4 py-2" style={{ backgroundColor: '#f9f9f9' }}>
          <form method="get" className="flex items-center gap-2">
            <input
              type="text"
              name="q"
              defaultValue={sp.q ?? ''}
              placeholder="旧社債管理ID・会員ID・会員氏名・申込ID・社債名・今回の結果で検索"
              className="h-8 w-96 rounded border border-input bg-white px-2 text-sm"
            />
            <button
              type="submit"
              className="h-8 rounded bg-primary px-3 text-sm font-medium text-primary-foreground"
            >
              検索
            </button>
            {sp.q ? (
              <Link href="/legacy-bonds" className="sf-link text-sm">
                クリア
              </Link>
            ) : null}
          </form>
        </div>

        <LegacyBondsInfinite
          key={listKey}
          initialRows={result.rows as unknown as Array<Record<string, unknown>>}
          fields={listFields}
          total={result.total}
          params={{ q: sp.q, sort: sp.sort, dir }}
          canDelete
        />
      </Card>
    </div>
  );
}
