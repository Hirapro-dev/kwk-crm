'use client';

/**
 * 出金管理-親/子 一覧の無限スクロール表示 (CLAUDE.md §5.13)。
 * 他オブジェクトと同じ InfiniteTable を使い、下端到達で次ページを追記する。
 * 一覧カラムはオブジェクト管理(field_definitions)の設定に従う。
 *
 * リンク規則:
 *   - id(償還No) → 自オブジェクトの詳細ページ
 *   - parent_no(子のみ) → 親詳細ページ(parent_id が解決済みの行のみ)
 *   - 会員ID / 会員氏名 → 会員詳細ページ(会員が紐付く行のみ)
 */

import { type InfiniteCol, InfiniteTable } from '@/components/layout/InfiniteTable';
import { TableCell } from '@/components/ui/table';
import { LIST_PAGE_SIZE } from '@/lib/domain/list_constants';
import {
  loadMoreWithdrawalChildren,
  loadMoreWithdrawalParents,
} from '@/lib/domain/list_more_actions';
import type { FieldDefinition } from '@/lib/domain/object_metadata';
import { formatFieldValue, getFieldValue } from '@/lib/utils/format_field';
import Link from 'next/link';

type Row = Record<string, unknown>;

interface Props {
  /** 親(withdrawal_parents) or 子(withdrawal_children) */
  object: 'withdrawal_parents' | 'withdrawal_children';
  initialRows: Row[];
  fields: FieldDefinition[];
  total: number;
  params: { q?: string; sort?: string; dir?: 'asc' | 'desc' };
}

export function WithdrawalsInfinite({ object, initialRows, fields, total, params }: Props) {
  const basePath = object === 'withdrawal_parents' ? '/withdrawal-parents' : '/withdrawal-children';
  const loadMore =
    object === 'withdrawal_parents' ? loadMoreWithdrawalParents : loadMoreWithdrawalChildren;

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
    sortField: f.is_in_db ? f.field_name : undefined,
  }));

  const renderRow = (row: Row) => {
    const id = String(row.id ?? '');
    const memberId = row.member_id ? String(row.member_id) : null;
    return fields.map((f) => {
      // 償還No: 自詳細ページへ
      if (f.field_name === 'id') {
        return (
          <TableCell key={f.id} className="whitespace-nowrap py-2 text-sm">
            <Link href={`${basePath}/${id}`} className="sf-link font-medium">
              {id}
            </Link>
          </TableCell>
        );
      }
      // 償還-親No(子のみ): 親詳細へ(親が解決済みの行のみリンク)
      if (f.field_name === 'parent_no') {
        const pno = row.parent_no ? String(row.parent_no) : null;
        const pid = row.parent_id ? String(row.parent_id) : null;
        return (
          <TableCell key={f.id} className="whitespace-nowrap py-2 text-sm">
            {pid ? (
              <Link href={`/withdrawal-parents/${pid}`} className="text-primary hover:underline">
                {pno}
              </Link>
            ) : (
              (pno ?? '-')
            )}
          </TableCell>
        );
      }
      // 会員ID / 会員氏名: 会員詳細へ(会員が紐付く行のみ)
      if (memberId && (f.field_name === 'member_id' || f.field_name === 'member_name')) {
        const text = f.field_name === 'member_id' ? memberId : String(row.member_name ?? '-');
        return (
          <TableCell key={f.id} className="whitespace-nowrap py-2 text-sm">
            <Link href={`/members/${memberId}`} className="text-primary hover:underline">
              {text}
            </Link>
          </TableCell>
        );
      }
      const raw = getFieldValue(row, f.field_name, f.is_in_db, f.csv_column_name);
      const formatted = formatFieldValue(raw, f.data_type, f.label ?? f.field_name);
      return (
        <TableCell key={f.id} className="whitespace-nowrap py-2 text-sm">
          {formatted}
        </TableCell>
      );
    });
  };

  return (
    <InfiniteTable<Row>
      initialRows={initialRows}
      total={total}
      pageSize={LIST_PAGE_SIZE}
      loadMore={async (page) => (await loadMore(params, page)) as unknown as Row[]}
      columns={columns}
      renderRow={renderRow}
      getKey={(r) => String(r.id)}
      emptyMessage="該当するデータがありません"
    />
  );
}
