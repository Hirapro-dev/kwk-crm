'use client';

/**
 * 旧社債管理 一覧の無限スクロール表示(CLAUDE.md §5.13c)。
 * 他オブジェクトと同じ InfiniteTable を使い、一覧カラムは項目管理(field_definitions)の設定に従う。
 * リンク規則: id → 自詳細 / 会員ID・会員氏名 → 会員詳細(紐付く行のみ)/ 申込ID → 申込詳細(紐付く行のみ)。
 */

import { type InfiniteCol, InfiniteTable } from '@/components/layout/InfiniteTable';
import { TableCell } from '@/components/ui/table';
import { deleteRecords } from '@/lib/domain/delete_actions';
import type { LegacyBondListParams } from '@/lib/domain/legacy_bonds';
import { legacyBondAttention } from '@/lib/domain/legacy_bonds_calc';
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
  params: LegacyBondListParams;
  /** 左端の選択チェックボックス・削除ボタンを出すか(admin のみ) */
  canDelete?: boolean;
}

/** 今月(日本時間)の "YYYY/MM" */
function currentJstYm(): string {
  const j = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return `${j.getUTCFullYear()}/${String(j.getUTCMonth() + 1).padStart(2, '0')}`;
}

const ATTENTION_LABEL = { overdue: '満期超過', soon: '満期間近' } as const;

export function LegacyBondsInfinite({ initialRows, fields, total, params, canDelete }: Props) {
  const nowYm = currentJstYm();
  // 回答が決まっていない行のうち、満期を過ぎたもの(赤)と 2 か月以内のもの(黄)を目立たせる(2026-10-23)
  const attentionOf = (row: Row) =>
    legacyBondAttention(
      {
        redemption_month: row.redemption_month ? String(row.redemption_month) : null,
        result: row.result ? String(row.result) : null,
      },
      nowYm,
    );

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
      if (f.field_name === 'result') {
        const att = attentionOf(row);
        return (
          <TableCell key={f.id} className="whitespace-nowrap py-2 text-sm">
            {row.result ? String(row.result) : '-'}
            {att && (
              <span
                className={`ml-1 rounded px-1 text-[10px] ${att === 'overdue' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}
              >
                {ATTENTION_LABEL[att]}
              </span>
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
      rowClassName={(r) => {
        const att = attentionOf(r);
        return att === 'overdue' ? 'bg-red-50' : att === 'soon' ? 'bg-amber-50' : undefined;
      }}
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
