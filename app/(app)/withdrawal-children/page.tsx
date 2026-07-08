/**
 * 出金管理-子 一覧画面 (CLAUDE.md §5.13 / §8.1)
 *
 * 出金(子)を一覧表示する。閲覧は admin/manager/support のみ(RLSでも制限)。
 * 一覧カラムはオブジェクト管理(/settings/objects/withdrawal_children)の設定に従う。
 * 表示は他オブジェクトと同じ無限スクロール。
 */

import { Card } from '@/components/ui/card';
import { WithdrawalsInfinite } from '@/components/withdrawals/WithdrawalsInfinite';
import { getCurrentUser } from '@/lib/domain/auth';
import { LIST_PAGE_SIZE } from '@/lib/domain/list_constants';
import { getVisibleFields } from '@/lib/domain/object_metadata';
import { listWithdrawalChildren } from '@/lib/domain/withdrawals';
import Link from 'next/link';

const ALLOWED_ROLES = new Set(['admin', 'manager', 'support']);

interface PageProps {
  searchParams: Promise<{ q?: string; sort?: string; dir?: string }>;
}

export default async function WithdrawalChildrenPage({ searchParams }: PageProps) {
  const me = await getCurrentUser();
  if (!ALLOWED_ROLES.has(me.role)) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        このページを表示する権限がありません。
      </p>
    );
  }

  const sp = await searchParams;
  const dir = sp.dir === 'asc' ? 'asc' : 'desc';

  const [result, listFields] = await Promise.all([
    listWithdrawalChildren({ q: sp.q, sort: sp.sort, dir, page: 1, pageSize: LIST_PAGE_SIZE }),
    getVisibleFields('withdrawal_children', 'list'),
  ]);

  const listKey = `${sp.q ?? ''}|${sp.sort ?? ''}|${dir}`;

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0 shadow-sm">
        {/* ヘッダー部: アイコン + タイトル + 件数 */}
        <div className="flex items-start justify-between border-b px-4 py-3">
          <div className="flex items-center gap-3">
            <span
              className="sf-icon-chip"
              style={{ backgroundColor: '#e08a5a' }}
              aria-hidden="true"
            >
              WDC
            </span>
            <div className="flex flex-col">
              <h1 className="text-base font-bold text-foreground">出金管理-子</h1>
              <span className="text-xs text-muted-foreground">
                {result.total.toLocaleString()} 件
              </span>
            </div>
          </div>
        </div>

        {/* 検索帯(償還-子No / 償還-親No / 会員ID / 会員氏名 / 投資案件 を部分一致) */}
        <div className="border-b px-4 py-2" style={{ backgroundColor: '#f9f9f9' }}>
          <form method="get" className="flex items-center gap-2">
            <input
              type="text"
              name="q"
              defaultValue={sp.q ?? ''}
              placeholder="償還-子No・償還-親No・会員ID・会員氏名・投資案件で検索"
              className="h-8 w-96 rounded border border-input bg-white px-2 text-sm"
            />
            <button
              type="submit"
              className="h-8 rounded bg-primary px-3 text-sm font-medium text-primary-foreground"
            >
              検索
            </button>
            {sp.q ? (
              <Link href="/withdrawal-children" className="sf-link text-sm">
                クリア
              </Link>
            ) : null}
          </form>
        </div>

        {/* 一覧テーブル(カラムはオブジェクト管理に従う / 無限スクロール) */}
        <WithdrawalsInfinite
          key={listKey}
          object="withdrawal_children"
          initialRows={result.rows as unknown as Array<Record<string, unknown>>}
          fields={listFields}
          total={result.total}
          params={{ q: sp.q, sort: sp.sort, dir }}
        />
      </Card>
    </div>
  );
}
