'use client';

import { type InfiniteCol, InfiniteTable } from '@/components/layout/InfiniteTable';
import { PhoneLink } from '@/components/layout/PhoneLink';
import { TableCell } from '@/components/ui/table';
import { LIST_PAGE_SIZE } from '@/lib/domain/list_constants';
import { loadMoreMembers } from '@/lib/domain/list_more_actions';
import type { FieldDefinition } from '@/lib/domain/object_metadata';
import type { MemberWithOwner } from '@/lib/domain/types';
import { formatFieldValue, getFieldValue } from '@/lib/utils/format_field';
import Link from 'next/link';

interface Props {
  initialRows: MemberWithOwner[];
  fields: FieldDefinition[];
  total: number;
  params: { q?: string; ownerId?: string; sort?: string; dir?: 'asc' | 'desc' };
}

export function MembersInfinite({ initialRows, fields, total, params }: Props) {
  const columns: InfiniteCol[] = fields.map((f) => ({
    header: f.label ?? f.field_name,
    sortField: f.is_in_db ? f.field_name : undefined,
  }));

  const renderRow = (m: MemberWithOwner) => {
    const rec = m as unknown as Record<string, unknown>;
    const id = String(rec.id ?? '');
    return fields.map((f, i) => {
      if (i === 0) {
        const raw = f.is_in_db
          ? rec[f.field_name]
          : (rec.extra as Record<string, unknown> | null | undefined)?.[f.field_name];
        const text = raw === null || raw === undefined || raw === '' ? id : String(raw);
        return (
          <TableCell key={f.id} className="whitespace-nowrap py-2">
            <Link href={`/members/${id}`} className="sf-link font-medium">
              {text}
            </Link>
          </TableCell>
        );
      }
      if (f.field_name === 'protect_by_user_id') {
        const protectUser = (m as MemberWithOwner).protect_by_user;
        const name = protectUser?.full_name ?? null;
        return (
          <TableCell key={f.id} className="whitespace-nowrap py-2 text-sm">
            {protectUser ? (
              <Link href={`/settings/users/${protectUser.id}`} className="sf-link">
                {name ?? protectUser.id}
              </Link>
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </TableCell>
        );
      }
      const raw = getFieldValue(rec, f.field_name, f.is_in_db);
      const formatted = formatFieldValue(raw, f.data_type);
      const isPhone = f.field_name === 'phone1' || f.field_name === 'phone';
      return (
        <TableCell key={f.id} className="whitespace-nowrap py-2 text-sm">
          {isPhone && formatted ? <PhoneLink value={formatted} /> : formatted}
        </TableCell>
      );
    });
  };

  if (fields.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        表示するカラムが選択されていません。
      </p>
    );
  }

  return (
    <InfiniteTable
      initialRows={initialRows}
      total={total}
      pageSize={LIST_PAGE_SIZE}
      loadMore={(page) => loadMoreMembers(params, page)}
      columns={columns}
      renderRow={renderRow}
      getKey={(m) => String((m as unknown as Record<string, unknown>).id)}
      emptyMessage="該当する会員がいません"
    />
  );
}
