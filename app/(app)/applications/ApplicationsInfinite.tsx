'use client';

import { type InfiniteCol, InfiniteTable } from '@/components/layout/InfiniteTable';
import { Badge } from '@/components/ui/badge';
import { TableCell } from '@/components/ui/table';
import type { AppStatus, ApplicationListItem } from '@/lib/domain/applications';
import { LIST_PAGE_SIZE } from '@/lib/domain/list_constants';
import { loadMoreApplications } from '@/lib/domain/list_more_actions';
import type { FieldDefinition } from '@/lib/domain/object_metadata';
import { formatFieldValue, getFieldValue } from '@/lib/utils/format_field';
import Link from 'next/link';

interface Props {
  initialRows: ApplicationListItem[];
  fields: FieldDefinition[];
  total: number;
  params: {
    q?: string;
    projectId?: number;
    status?: string;
    sort?: string;
    dir?: 'asc' | 'desc';
  };
}

const STATUS_VARIANT: Record<AppStatus, 'default' | 'secondary' | 'outline' | 'success'> = {
  対応中: 'default',
  未購入: 'outline',
  完了: 'success',
  出金: 'secondary',
  資金移動: 'secondary',
};

/** 金額表示する DBカラム(¥ + 右寄せ) */
const AMOUNT_FIELDS = new Set([
  'payment_amount',
  'scheduled_amount',
  'withdrawal_amount',
  'transfer_amount',
  'crypto_excluded_amount',
]);

export function ApplicationsInfinite({ initialRows, fields, total, params }: Props) {
  const columns: InfiniteCol[] = fields.map((f) => {
    const amount = AMOUNT_FIELDS.has(f.field_name);
    return {
      header: f.label ?? f.field_name,
      sortField: f.is_in_db ? f.field_name : undefined,
      headClassName: amount ? 'h-9 whitespace-nowrap text-right' : undefined,
    };
  });

  const renderRow = (a: ApplicationListItem) => {
    const rec = a as unknown as Record<string, unknown>;
    return fields.map((f, i) => {
      const isFirst = i === 0;

      // 申込ID: 詳細リンク
      if (f.field_name === 'id') {
        return (
          <TableCell key={f.id} className="whitespace-nowrap py-2 font-mono text-xs">
            <Link href={`/applications/${a.id}`} className="sf-link font-medium">
              {a.id}
            </Link>
          </TableCell>
        );
      }

      // 会員: 会員詳細リンク
      if (f.field_name === 'member_id') {
        return (
          <TableCell key={f.id} className="whitespace-nowrap py-2 text-sm">
            {a.member ? (
              <Link href={`/members/${a.member.id}`} className="sf-link">
                {a.member.name}
              </Link>
            ) : (
              '-'
            )}
          </TableCell>
        );
      }

      // 案件
      if (f.field_name === 'project_id') {
        return (
          <TableCell key={f.id} className="whitespace-nowrap py-2 text-sm">
            {a.project ? a.project.name : '-'}
          </TableCell>
        );
      }

      // 担当 / 申込獲得者(ユーザー名)。JOIN名が無ければ原文(_raw)にフォールバック
      if (f.field_name === 'owner_id') {
        return (
          <TableCell key={f.id} className="whitespace-nowrap py-2 text-sm">
            {a.owner?.full_name ?? a.owner_name_raw ?? '-'}
          </TableCell>
        );
      }
      if (f.field_name === 'acquirer_id') {
        return (
          <TableCell key={f.id} className="whitespace-nowrap py-2 text-sm">
            {a.acquirer?.full_name ?? a.acquirer_name_raw ?? '-'}
          </TableCell>
        );
      }

      // ステータス: バッジ
      if (f.field_name === 'status') {
        return (
          <TableCell key={f.id} className="whitespace-nowrap py-2">
            {a.status ? <Badge variant={STATUS_VARIANT[a.status]}>{a.status}</Badge> : '-'}
          </TableCell>
        );
      }

      // 金額系: ¥ + 右寄せ
      if (AMOUNT_FIELDS.has(f.field_name)) {
        const v = rec[f.field_name];
        return (
          <TableCell key={f.id} className="whitespace-nowrap py-2 text-right tabular-nums text-sm">
            {v !== null && v !== undefined && v !== '' ? `¥${Number(v).toLocaleString()}` : '-'}
          </TableCell>
        );
      }

      // 汎用(日付/数値/テキスト/extra)
      const raw = getFieldValue(rec, f.field_name, f.is_in_db, f.csv_column_name);
      const formatted = formatFieldValue(raw, f.data_type, f.label ?? f.field_name);
      const text = formatted === '' ? '-' : formatted;
      if (isFirst) {
        return (
          <TableCell key={f.id} className="whitespace-nowrap py-2">
            <Link href={`/applications/${a.id}`} className="sf-link font-medium">
              {text}
            </Link>
          </TableCell>
        );
      }
      return (
        <TableCell key={f.id} className="whitespace-nowrap py-2 text-sm">
          {text}
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
      loadMore={(page) => loadMoreApplications(params, page)}
      columns={columns}
      renderRow={renderRow}
      getKey={(a) => a.id}
      emptyMessage="該当する申込がありません"
    />
  );
}
