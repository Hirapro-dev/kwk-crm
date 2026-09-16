'use client';

/**
 * LP 一覧の無限スクロール表示(CLAUDE.md §5.17)。
 * 他オブジェクトと同じ InfiniteTable を使い、一覧カラムはオブジェクト管理(field_definitions)に従う。
 * リンク規則: id → LP 詳細 / 会員ID → 会員詳細(会員が紐付く行のみ)
 */

import { type InfiniteCol, InfiniteTable } from '@/components/layout/InfiniteTable';
import { TableCell } from '@/components/ui/table';
import { adLabel } from '@/lib/domain/ad_label';
import { deleteRecords } from '@/lib/domain/delete_actions';
import { LIST_PAGE_SIZE } from '@/lib/domain/list_constants';
import { loadMoreLpEntries } from '@/lib/domain/list_more_actions';
import type { FieldDefinition } from '@/lib/domain/object_metadata';
import { formatFieldValue, getFieldValue } from '@/lib/utils/format_field';
import Link from 'next/link';

type Row = Record<string, unknown>;

interface Props {
  initialRows: Row[];
  fields: FieldDefinition[];
  total: number;
  params: { q?: string; formName?: string; sort?: string; dir?: 'asc' | 'desc' };
  canDelete?: boolean;
  /** 広告ID → 広告媒体名(§5.18) */
  adNames?: Record<string, string>;
}

export function LpInfinite({ initialRows, fields, total, params, canDelete, adNames = {} }: Props) {
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
      if (f.field_name === 'id') {
        return (
          <TableCell key={f.id} className="whitespace-nowrap py-2 text-sm">
            <Link href={`/lp/${id}`} className="sf-link font-medium">
              {id}
            </Link>
          </TableCell>
        );
      }
      if (memberId && f.field_name === 'member_id') {
        return (
          <TableCell key={f.id} className="whitespace-nowrap py-2 text-sm">
            <Link href={`/members/${memberId}`} className="text-primary hover:underline">
              {memberId}
            </Link>
          </TableCell>
        );
      }
      const raw = getFieldValue(row, f.field_name, f.is_in_db, f.csv_column_name);
      const formatted =
        f.field_name === 'ad_id'
          ? adLabel(typeof raw === 'string' ? raw : null, adNames)
          : formatFieldValue(raw, f.data_type, f.label ?? f.field_name);
      return (
        <TableCell
          key={f.id}
          className="max-w-[360px] truncate py-2 text-sm"
          title={String(raw ?? '')}
        >
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
      loadMore={async (page) => (await loadMoreLpEntries(params, page)) as unknown as Row[]}
      columns={columns}
      renderRow={renderRow}
      getKey={(r) => String(r.id)}
      emptyMessage="該当するデータがありません"
      selection={
        canDelete
          ? {
              getId: (r) => String(r.id),
              getLabel: (r) => String(r.id),
              objectLabel: 'LP',
              onDelete: (ids) => deleteRecords('lp_entries', ids),
            }
          : undefined
      }
    />
  );
}
