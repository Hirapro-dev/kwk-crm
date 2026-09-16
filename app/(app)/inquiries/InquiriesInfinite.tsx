'use client';

import { type InfiniteCol, InfiniteTable } from '@/components/layout/InfiniteTable';
import { PhoneLink } from '@/components/layout/PhoneLink';
import { TableCell } from '@/components/ui/table';
import { adLabel } from '@/lib/domain/ad_label';
import { deleteRecords } from '@/lib/domain/delete_actions';
import type { InquiryListItem } from '@/lib/domain/inquiries';
import { LIST_PAGE_SIZE } from '@/lib/domain/list_constants';
import { loadMoreInquiries } from '@/lib/domain/list_more_actions';
import type { FieldDefinition } from '@/lib/domain/object_metadata';
import { formatFieldValue, getFieldValue } from '@/lib/utils/format_field';
import Link from 'next/link';
import { LeadActions } from './LeadActions';

interface Props {
  initialRows: InquiryListItem[];
  fields: FieldDefinition[];
  total: number;
  params: {
    q?: string;
    formId?: number;
    unassigned?: boolean;
    /** メール取込分のみ(リード一覧。§5.16)。true のとき照合状態と操作の列を出す */
    mailImported?: boolean;
    sort?: string;
    dir?: 'asc' | 'desc';
  };
  /** 左端の選択チェックボックス・削除ボタンを出すか (admin のみ) */
  canDelete?: boolean;
  /** 広告ID → 広告媒体名(§5.18。広告ID の列に媒体名を併記する) */
  adNames?: Record<string, string>;
}

export function InquiriesInfinite({
  initialRows,
  fields,
  total,
  params,
  canDelete,
  adNames = {},
}: Props) {
  const leadMode = !!params.mailImported;
  const columns: InfiniteCol[] = [
    ...(leadMode ? [{ header: '会員照合 / 操作', headClassName: 'w-80' }] : []),
    ...fields.map((f) => ({
      header: f.label ?? f.field_name,
      sortField: f.is_in_db ? f.field_name : undefined,
    })),
  ];

  const renderRow = (r: InquiryListItem) => {
    const rec = r as unknown as Record<string, unknown>;
    const leadCell = leadMode
      ? [
          <TableCell key="lead" className="py-2">
            <LeadActions inquiry={r} />
          </TableCell>,
        ]
      : [];
    const fieldCells = fields.map((f, i) => {
      const isFirst = i === 0;

      // 問合せID: 詳細リンク
      if (f.field_name === 'id') {
        return (
          <TableCell key={f.id} className="whitespace-nowrap py-2 font-mono text-xs">
            <Link href={`/inquiries/${r.id}`} className="sf-link font-medium">
              {r.id}
            </Link>
          </TableCell>
        );
      }

      // フォーム: 名称のみ表示(分類バッジは非表示)
      if (f.field_name === 'form_id') {
        return (
          <TableCell key={f.id} className="py-2 text-xs">
            {r.form ? <span className="whitespace-nowrap">{r.form.name}</span> : '-'}
          </TableCell>
        );
      }

      // 氏名: 会員化済なら会員詳細リンク
      if (f.field_name === 'name') {
        return (
          <TableCell key={f.id} className="whitespace-nowrap py-2 text-sm">
            {r.name ? (
              r.member ? (
                <Link href={`/members/${r.member.id}`} className="sf-link">
                  {r.name}
                </Link>
              ) : (
                r.name
              )
            ) : (
              '-'
            )}
          </TableCell>
        );
      }

      // 電話
      if (f.field_name === 'phone') {
        return (
          <TableCell key={f.id} className="whitespace-nowrap py-2 text-xs">
            <PhoneLink value={r.phone} />
          </TableCell>
        );
      }

      // 汎用(日付/数値/テキスト/extra)。広告ID は媒体名を併記
      const raw = getFieldValue(rec, f.field_name, f.is_in_db, f.csv_column_name);
      const formatted =
        f.field_name === 'ad_id'
          ? adLabel(typeof raw === 'string' ? raw : null, adNames)
          : formatFieldValue(raw, f.data_type, f.label ?? f.field_name);
      const text = formatted === '' ? '-' : formatted;
      if (isFirst) {
        return (
          <TableCell key={f.id} className="whitespace-nowrap py-2">
            <Link href={`/inquiries/${r.id}`} className="sf-link font-medium">
              {text}
            </Link>
          </TableCell>
        );
      }
      return (
        <TableCell key={f.id} className="whitespace-nowrap py-2 text-xs">
          {text}
        </TableCell>
      );
    });
    return [...leadCell, ...fieldCells];
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
      loadMore={(page) => loadMoreInquiries(params, page)}
      columns={columns}
      renderRow={renderRow}
      getKey={(r) => r.id}
      emptyMessage="該当する問合せがありません"
      selection={
        canDelete
          ? {
              getId: (r) => r.id,
              getLabel: (r) => r.name ?? r.id,
              objectLabel: '問合せ',
              onDelete: (ids) => deleteRecords('inquiries', ids),
            }
          : undefined
      }
    />
  );
}
