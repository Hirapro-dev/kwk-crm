import { PhoneLink } from '@/components/layout/PhoneLink';
import { SortHeader } from '@/components/layout/SortHeader';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { FieldDefinition } from '@/lib/domain/object_metadata';
import { formatFieldValue, getFieldValue } from '@/lib/utils/format_field';
import type { ReactNode } from 'react';

/**
 * field_definitions に基づいて、リスト形式 (テーブル) でレコード一覧を描画する部品。
 *
 * 仕様 (Phase 2):
 *   - is_visible_list=true のフィールドを sort_order_list 順で列にする
 *   - 各セル値はデータ型でフォーマット
 *   - is_in_db=false (extra jsonb) のフィールドは record.extra から取得
 *   - 行クリック / リンク を扱うため、firstColRenderer プロップで先頭列の描画をカスタム可能
 *
 * 想定使用: /members, /inquiries, /applications 等の一覧画面
 */
interface Props<T extends Record<string, unknown>> {
  rows: T[];
  fields: FieldDefinition[];
  /** 行の React key を返す関数 (省略時は index) */
  rowKey?: (row: T, idx: number) => string;
  /**
   * 先頭列だけ別の描画 (リンク化など) をしたい場合に渡す。
   * 戻り値が null なら通常通り formatFieldValue を使う。
   */
  firstColRenderer?: (row: T, field: FieldDefinition) => ReactNode | null;
  /**
   * 任意の列を別の描画 (リンク化など) をしたい場合に渡す。全列で評価される。
   * 戻り値が null なら通常通り (firstColRenderer or formatFieldValue) を使う。
   */
  cellRenderer?: (row: T, field: FieldDefinition) => ReactNode | null;
  /** データなしメッセージ */
  emptyMessage?: string;
}

export function DynamicListTable<T extends Record<string, unknown>>({
  rows,
  fields,
  rowKey,
  firstColRenderer,
  cellRenderer,
  emptyMessage = '該当するレコードがありません',
}: Props<T>) {
  if (fields.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        表示するカラムが選択されていません。
        <br />
        オブジェクト管理画面で「一覧」表示を ON にしてください。
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-gray-50 hover:bg-gray-50">
            {fields.map((f) => (
              <TableHead key={f.id} className="h-9 whitespace-nowrap">
                {f.is_in_db ? (
                  <SortHeader field={f.field_name} label={f.label ?? f.field_name} />
                ) : (
                  (f.label ?? f.field_name)
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={fields.length}
                className="text-center text-sm text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row, idx) => (
              <TableRow key={rowKey ? rowKey(row, idx) : idx} className="sf-row-hover">
                {fields.map((f, fi) => {
                  // 任意列のカスタム描画優先 (リンク化など)
                  if (cellRenderer) {
                    const custom = cellRenderer(row, f);
                    if (custom !== null) {
                      return (
                        <TableCell key={f.id} className="whitespace-nowrap py-2 text-sm">
                          {custom}
                        </TableCell>
                      );
                    }
                  }
                  // 先頭列はカスタム描画優先
                  if (fi === 0 && firstColRenderer) {
                    const custom = firstColRenderer(row, f);
                    if (custom !== null) {
                      return (
                        <TableCell key={f.id} className="whitespace-nowrap py-2">
                          {custom}
                        </TableCell>
                      );
                    }
                  }
                  const raw = getFieldValue(row, f.field_name, f.is_in_db, f.csv_column_name);
                  const formatted = formatFieldValue(raw, f.data_type, f.label ?? f.field_name);
                  // 電話番号列はスマホでタップ発信できるよう tel: リンク化
                  const isPhone = f.field_name === 'phone1' || f.field_name === 'phone';
                  return (
                    <TableCell
                      key={f.id}
                      // 折り返しさせず、横幅は内容に合わせて伸びる。
                      // 表全体は <div className="overflow-x-auto"> で横スクロール可能。
                      className="whitespace-nowrap py-2 text-sm"
                    >
                      {isPhone && formatted ? <PhoneLink value={formatted} /> : formatted}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
