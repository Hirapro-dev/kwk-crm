/**
 * 記事反応リスト一覧画面 (CLAUDE.md §5.13相当 / §8.1)
 *
 * 会員のメルマガ等への反応(クリック等)を一覧表示する。
 * 一覧カラムはオブジェクト管理(/settings/objects/article_reactions)の設定に従う。
 * 表示は他オブジェクトと同じ無限スクロール(下端到達で次ページを追記)。
 */

import { Card } from '@/components/ui/card';
import { listArticleReactions } from '@/lib/domain/article_reactions';
import { LIST_PAGE_SIZE } from '@/lib/domain/list_constants';
import { getVisibleFields } from '@/lib/domain/object_metadata';
import Link from 'next/link';
import { ArticleReactionsInfinite } from './ArticleReactionsInfinite';

interface PageProps {
  searchParams: Promise<{
    q?: string;
    sort?: string;
    dir?: string;
  }>;
}

export default async function ArticleReactionsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const dir = sp.dir === 'asc' ? 'asc' : 'desc';

  const [result, listFields] = await Promise.all([
    listArticleReactions({
      q: sp.q,
      sort: sp.sort,
      dir,
      page: 1,
      pageSize: LIST_PAGE_SIZE,
    }),
    getVisibleFields('article_reactions', 'list'),
  ]);

  // フィルタ/ソート変更時に無限スクロールを最初から読み直すための再マウントキー
  const listKey = `${sp.q ?? ''}|${sp.sort ?? ''}|${dir}`;

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0 shadow-sm">
        {/* ヘッダー部: アイコン + タイトル + 件数 */}
        <div className="flex items-start justify-between border-b px-4 py-3">
          <div className="flex items-center gap-3">
            <span
              className="sf-icon-chip"
              style={{ backgroundColor: '#00C896' }}
              aria-hidden="true"
            >
              ART
            </span>
            <div className="flex flex-col">
              <h1 className="text-base font-bold text-foreground">記事反応リスト</h1>
              <span className="text-xs text-muted-foreground">
                {result.total.toLocaleString()} 件
              </span>
            </div>
          </div>
        </div>

        {/* 検索帯(会員ID / 会員氏名 / 反応ID / 詳細 を部分一致) */}
        <div className="border-b px-4 py-2" style={{ backgroundColor: '#f9f9f9' }}>
          <form method="get" className="flex items-center gap-2">
            <input
              type="text"
              name="q"
              defaultValue={sp.q ?? ''}
              placeholder="会員ID・会員氏名・反応ID・詳細で検索"
              className="h-8 w-72 rounded border border-input bg-white px-2 text-sm"
            />
            <button
              type="submit"
              className="h-8 rounded bg-primary px-3 text-sm font-medium text-primary-foreground"
            >
              検索
            </button>
            {sp.q ? (
              <Link href="/article-reactions" className="sf-link text-sm">
                クリア
              </Link>
            ) : null}
          </form>
        </div>

        {/* 一覧テーブル(カラムはオブジェクト管理に従う / 無限スクロール) */}
        <ArticleReactionsInfinite
          key={listKey}
          initialRows={result.rows}
          fields={listFields}
          total={result.total}
          params={{ q: sp.q, sort: sp.sort, dir }}
        />
      </Card>
    </div>
  );
}
