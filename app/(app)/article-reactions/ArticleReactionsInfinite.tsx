'use client';

/**
 * 記事反応リスト一覧の無限スクロール表示。
 * 他オブジェクト(会員等)と同じ InfiniteTable を使い、下端到達で次ページを追記する。
 * 一覧カラムはオブジェクト管理(field_definitions)の設定に従う。
 * 会員ID / 会員氏名 は会員が紐付く行のみ会員詳細へのリンクにする。
 */

import { type InfiniteCol, InfiniteTable } from '@/components/layout/InfiniteTable';
import { TableCell } from '@/components/ui/table';
import type { ArticleReactionRow } from '@/lib/domain/article_reactions';
import { LIST_PAGE_SIZE } from '@/lib/domain/list_constants';
import { loadMoreArticleReactions } from '@/lib/domain/list_more_actions';
import type { FieldDefinition } from '@/lib/domain/object_metadata';
import { formatFieldValue, getFieldValue } from '@/lib/utils/format_field';
import Link from 'next/link';

interface Props {
  initialRows: ArticleReactionRow[];
  fields: FieldDefinition[];
  total: number;
  params: { q?: string; sort?: string; dir?: 'asc' | 'desc' };
}

export function ArticleReactionsInfinite({ initialRows, fields, total, params }: Props) {
  if (fields.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        表示するカラムが選択されていません。
        <br />
        オブジェクト管理画面で「一覧」表示を ON にしてください。
      </p>
    );
  }

  const columns: InfiniteCol[] = fields.map((f) => ({
    header: f.label ?? f.field_name,
    // 実DBカラムのみソート可能(extra は listArticleReactions が未対応のため無効)
    sortField: f.is_in_db ? f.field_name : undefined,
  }));

  const renderRow = (row: ArticleReactionRow) => {
    const rec = row as unknown as Record<string, unknown>;
    return fields.map((f) => {
      // 会員ID / 会員氏名 は会員詳細へのリンク(会員が紐付く行のみ)
      if (row.member_id && (f.field_name === 'member_id' || f.field_name === 'member_name')) {
        const text = f.field_name === 'member_id' ? row.member_id : (row.member_name ?? '-');
        return (
          <TableCell key={f.id} className="whitespace-nowrap py-2 text-sm">
            <Link href={`/members/${row.member_id}`} className="text-primary hover:underline">
              {text}
            </Link>
          </TableCell>
        );
      }
      const raw = getFieldValue(rec, f.field_name, f.is_in_db, f.csv_column_name);
      const formatted = formatFieldValue(raw, f.data_type, f.label ?? f.field_name);
      return (
        <TableCell key={f.id} className="whitespace-nowrap py-2 text-sm">
          {formatted}
        </TableCell>
      );
    });
  };

  return (
    <InfiniteTable<ArticleReactionRow>
      initialRows={initialRows}
      total={total}
      pageSize={LIST_PAGE_SIZE}
      loadMore={(page) => loadMoreArticleReactions(params, page)}
      columns={columns}
      renderRow={renderRow}
      getKey={(r) => r.id}
      emptyMessage="該当する記事反応がありません"
    />
  );
}
