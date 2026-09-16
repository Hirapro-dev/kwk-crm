/**
 * LP 一覧画面(CLAUDE.md §5.17 / §8.1)
 *
 * LP・メルマガ登録系フォームの問合せ(Salesforce 由来。問合せとは別オブジェクト)を一覧表示する。
 * 一覧カラムはオブジェクト管理(/settings/objects/lp_entries)の設定に従う。無限スクロール。
 */

import { PanelFilterBar, PanelHeader } from '@/components/layout/PanelHeader';
import { Card } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/domain/auth';
import { LIST_PAGE_SIZE } from '@/lib/domain/list_constants';
import { listLpEntries, listLpFormNames } from '@/lib/domain/lp';
import { getAdNameMap } from '@/lib/domain/masters';
import { getVisibleFields } from '@/lib/domain/object_metadata';
import Link from 'next/link';
import { LpInfinite } from './LpInfinite';

interface PageProps {
  searchParams: Promise<{
    q?: string;
    form?: string;
    /** '1' = メール取込分のみ(§5.16 / migration 99) */
    mail?: string;
    sort?: string;
    dir?: string;
  }>;
}

export default async function LpPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const dir = sp.dir === 'asc' ? 'asc' : 'desc';
  const formName = sp.form || undefined;
  const mailImported = sp.mail === '1';

  const [me, result, listFields, formNames, adNames] = await Promise.all([
    getCurrentUser(),
    listLpEntries({
      q: sp.q,
      formName,
      mailImported,
      sort: sp.sort,
      dir,
      page: 1,
      pageSize: LIST_PAGE_SIZE,
    }),
    getVisibleFields('lp_entries', 'list'),
    listLpFormNames(),
    getAdNameMap(),
  ]);
  const listKey = `${sp.q ?? ''}|${formName ?? ''}|${mailImported ? 1 : 0}|${sp.sort ?? ''}|${dir}`;

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader iconLabel="LP" iconColor="#8b5cf6" viewName="LP" totalCount={result.total} />

        <PanelFilterBar>
          <form method="get" className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              name="q"
              defaultValue={sp.q ?? ''}
              placeholder="問合せID・メール・氏名・かな・会員IDで検索"
              className="h-8 w-80 rounded border border-input bg-white px-2 text-sm"
            />
            <select
              name="form"
              defaultValue={formName ?? ''}
              className="h-8 max-w-[24rem] rounded border border-input bg-white px-2 text-sm"
              aria-label="フォーム名で絞り込み"
            >
              <option value="">フォーム: すべて</option>
              {formNames.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" name="mail" value="1" defaultChecked={mailImported} />
              メール取込分のみ
            </label>
            <button
              type="submit"
              className="h-8 rounded bg-primary px-3 text-sm font-medium text-primary-foreground"
            >
              検索
            </button>
            {(sp.q || formName || mailImported) && (
              <Link href="/lp" className="sf-link text-sm">
                クリア
              </Link>
            )}
          </form>
        </PanelFilterBar>

        <LpInfinite
          key={listKey}
          initialRows={result.rows as unknown as Array<Record<string, unknown>>}
          fields={listFields}
          total={result.total}
          params={{ q: sp.q, formName, mailImported, sort: sp.sort, dir }}
          canDelete={me.role === 'admin'}
          adNames={adNames}
        />
      </Card>
    </div>
  );
}
