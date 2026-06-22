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
  /** データなしメッセージ */
  emptyMessage?: string;
}

export function DynamicListTable<T extends Record<string, unknown>>({
  rows,
  fields,
  rowKey,
  firstColRenderer,
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
          <TableRow className="bg-secondary/50 hover:bg-secondary/50">
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
                  const raw = getFieldValue(row, f.field_name, f.is_in_db);
                  const formatted = formatFieldValue(raw, f.data_type);
                  return (
                    <TableCell
                      key={f.id}
                      // 折り返しさせず、横幅は内容に合わせて伸びる。
                      // 表全体は <div className="overflow-x-auto"> で横スクロール可能。
                      className="whitespace-nowrap py-2 text-sm"
                    >
                      {formatted}
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
