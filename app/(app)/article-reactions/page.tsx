/**
 * 記事反応リスト一覧画面 (CLAUDE.md §5.13相当 / §8.1)
 *
 * 会員のメルマガ等への反応(クリック等)を一覧表示する。
 * 一覧カラムはオブジェクト管理(/settings/objects/article_reactions)の設定に従う。
 */

import { DynamicListTable } from '@/components/objects/DynamicListTable';
import { Card } from '@/components/ui/card';
import { type ArticleReactionRow, listArticleReactions } from '@/lib/domain/article_reactions';
import { getVisibleFields } from '@/lib/domain/object_metadata';
import Link from 'next/link';

interface PageProps {
  searchParams: Promise<{
    q?: string;
    sort?: string;
    dir?: string;
    page?: string;
  }>;
}

export default async function ArticleReactionsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const page = sp.page ? Math.max(1, Number.parseInt(sp.page, 10) || 1) : 1;

  const [result, listFields] = await Promise.all([
    listArticleReactions({
      q: sp.q,
      sort: sp.sort,
      dir: sp.dir === 'asc' ? 'asc' : 'desc',
      page,
    }),
    getVisibleFields('article_reactions', 'list'),
  ]);

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const mkHref = (p: number) => {
    const params = new URLSearchParams();
    if (sp.q) params.set('q', sp.q);
    if (sp.sort) params.set('sort', sp.sort);
    if (sp.dir) params.set('dir', sp.dir);
    params.set('page', String(p));
    return `/article-reactions?${params.toString()}`;
  };

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

        {/* 一覧テーブル(カラムはオブジェクト管理に従う) */}
        <DynamicListTable<ArticleReactionRow & Record<string, unknown>>
          rows={result.rows as Array<ArticleReactionRow & Record<string, unknown>>}
          fields={listFields}
          rowKey={(row) => row.id}
          emptyMessage="該当する記事反応がありません"
          // 会員ID / 会員氏名 は会員詳細へのリンクにする(会員が紐付く行のみ)
          cellRenderer={(row, field) => {
            if (!row.member_id) return null;
            if (field.field_name === 'member_id') {
              return (
                <Link href={`/members/${row.member_id}`} className="text-primary hover:underline">
                  {row.member_id}
                </Link>
              );
            }
            if (field.field_name === 'member_name') {
              return (
                <Link href={`/members/${row.member_id}`} className="text-primary hover:underline">
                  {row.member_name ?? '-'}
                </Link>
              );
            }
            return null;
          }}
        />

        {/* ページ送り */}
        <div className="flex items-center justify-between border-t px-4 py-2 text-sm">
          <span className="text-muted-foreground">
            {result.total.toLocaleString()} 件中 {result.page} / {totalPages} ページ
          </span>
          <div className="flex items-center gap-2">
            {page > 1 ? (
              <Link href={mkHref(page - 1)} className="sf-link">
                ← 前へ
              </Link>
            ) : (
              <span className="text-muted-foreground">← 前へ</span>
            )}
            {page < totalPages ? (
              <Link href={mkHref(page + 1)} className="sf-link">
                次へ →
              </Link>
            ) : (
              <span className="text-muted-foreground">次へ →</span>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
