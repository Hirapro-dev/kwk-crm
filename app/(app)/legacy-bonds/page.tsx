/**
 * 旧社債管理 一覧画面(CLAUDE.md §5.13c / §8.1)
 *
 * 旧社債の継続・償還の管理行(1 行 = 1 償還対象月の 1 申込)を一覧表示する。閲覧は admin のみ(RLS でも制限)。
 * 一覧カラムはオブジェクト管理(/settings/objects/legacy_bonds)の設定に従う。表示は無限スクロール。
 */

import { LegacyBondsFilterBar } from '@/components/legacy_bonds/LegacyBondsFilterBar';
import { LegacyBondsInfinite } from '@/components/legacy_bonds/LegacyBondsInfinite';
import { Card } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/domain/auth';
import { listLegacyBondFilterOptions, listLegacyBonds } from '@/lib/domain/legacy_bonds';
import { LIST_PAGE_SIZE } from '@/lib/domain/list_constants';
import { getVisibleFields } from '@/lib/domain/object_metadata';
import { Suspense } from 'react';

interface PageProps {
  searchParams: Promise<{
    q?: string;
    bond?: string;
    result?: string;
    from?: string;
    to?: string;
    sort?: string;
    dir?: string;
  }>;
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
  // 絞り込み・並び替えの条件(無限スクロールの追加読み込みにも同じものを渡す)
  const params = {
    q: sp.q,
    bondName: sp.bond,
    result: sp.result,
    monthFrom: sp.from,
    monthTo: sp.to,
    sort: sp.sort,
    dir,
  } as const;
  const [result, listFields, options] = await Promise.all([
    listLegacyBonds({ ...params, page: 1, pageSize: LIST_PAGE_SIZE }),
    getVisibleFields('legacy_bonds', 'list'),
    listLegacyBondFilterOptions(),
  ]);
  const listKey = [sp.q, sp.bond, sp.result, sp.from, sp.to, sp.sort, dir]
    .map((v) => v ?? '')
    .join('|');

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

        {/* 検索・フィルタ・並び替え(社債名 / 今回の結果 / 償還対象月の範囲 / 並び替え項目と向き) */}
        <div className="border-b px-4 py-2" style={{ backgroundColor: '#f9f9f9' }}>
          <Suspense>
            <LegacyBondsFilterBar
              initial={{
                q: sp.q ?? '',
                bond: sp.bond ?? '',
                result: sp.result ?? '',
                from: sp.from ?? '',
                to: sp.to ?? '',
                sort: sp.sort ?? '',
                dir,
              }}
              bondNames={options.bondNames}
              results={options.results}
            />
          </Suspense>
        </div>

        <LegacyBondsInfinite
          key={listKey}
          initialRows={result.rows as unknown as Array<Record<string, unknown>>}
          fields={listFields}
          total={result.total}
          params={params}
          canDelete
        />
      </Card>
    </div>
  );
}
