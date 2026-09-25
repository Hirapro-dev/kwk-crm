'use client';

/**
 * 旧社債管理 一覧の無限スクロール表示(CLAUDE.md §5.13c)。
 * 他オブジェクトと同じ InfiniteTable を使い、一覧カラムは項目管理(field_definitions)の設定に従う。
 * リンク規則: id → 自詳細 / 会員ID・会員氏名 → 会員詳細(紐付く行のみ)/ 申込ID → 申込詳細(紐付く行のみ)。
 */

import { type InfiniteCol, InfiniteTable } from '@/components/layout/InfiniteTable';
import { TableCell } from '@/components/ui/table';
import { deleteRecords } from '@/lib/domain/delete_actions';
import { LIST_PAGE_SIZE } from '@/lib/domain/list_constants';
import { loadMoreLegacyBonds } from '@/lib/domain/list_more_actions';
import type { FieldDefinition } from '@/lib/domain/object_metadata';
import { formatFieldValue, getFieldValue } from '@/lib/utils/format_field';
import Link from 'next/link';

type Row = Record<string, unknown>;

interface Props {
  initialRows: Row[];
  fields: FieldDefinition[];
  total: number;
  params: { q?: string; sort?: string; dir?: 'asc' | 'desc' };
  /** 左端の選択チェックボックス・削除ボタンを出すか(admin のみ) */
  canDelete?: boolean;
}

export function LegacyBondsInfinite({ initialRows, fields, total, params, canDelete }: Props) {
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
    const appId = row.application_id ? String(row.application_id) : null;
    return fields.map((f) => {
      if (f.field_name === 'id') {
        return (
          <TableCell key={f.id} className="whitespace-nowrap py-2 text-sm">
            <Link href={`/legacy-bonds/${id}`} className="sf-link font-medium">
              {id}
            </Link>
          </TableCell>
        );
      }
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
      if (f.field_name === 'application_no') {
        const no = row.application_no ? String(row.application_no) : null;
        return (
          <TableCell key={f.id} className="whitespace-nowrap py-2 text-sm">
            {appId ? (
              <Link href={`/applications/${appId}`} className="text-primary hover:underline">
                {no}
              </Link>
            ) : (
              (no ?? '-')
            )}
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
      loadMore={async (page) => (await loadMoreLegacyBonds(params, page)) as unknown as Row[]}
      columns={columns}
      renderRow={renderRow}
      getKey={(r) => String(r.id)}
      emptyMessage="該当するデータがありません"
      selection={
        canDelete
          ? {
              getId: (r) => String(r.id),
              getLabel: (r) => String(r.id),
              objectLabel: '旧社債管理',
              onDelete: (ids) => deleteRecords('legacy_bonds', ids),
            }
          : undefined
      }
    />
  );
}
