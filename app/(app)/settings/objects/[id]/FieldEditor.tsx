'use client';

import { Pencil, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { deleteField, updateField } from '@/lib/domain/object_metadata_actions';
import type { FieldDefinition } from '@/lib/domain/object_metadata';

/**
 * フィールド一覧の表 + 行内編集 (鉛筆クリック)。
 *
 * - 表示/非表示チェックは即時保存
 * - ラベル/並び順は編集モードで保存ボタン
 * - is_system=true は削除不可 (鉛筆編集は可)
 */
export function FieldEditor({ fields }: { fields: FieldDefinition[] }) {
  return (
    <Card className="overflow-hidden p-0 shadow-sm">
      <div className="overflow-x-auto">
        <Table className="min-w-[900px]">
          <TableHeader>
            <TableRow className="bg-gray-50 hover:bg-gray-50">
              <TableHead className="h-9">フィールド名</TableHead>
              <TableHead className="h-9">ラベル / CSV列名</TableHead>
              <TableHead className="h-9">型</TableHead>
              <TableHead className="h-9 text-center">一覧</TableHead>
              <TableHead className="h-9 text-center">詳細</TableHead>
              <TableHead className="h-9 text-right">並び(一覧)</TableHead>
              <TableHead className="h-9 text-right">並び(詳細)</TableHead>
              <TableHead className="h-9 w-28 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                  フィールドがありません
                </TableCell>
              </TableRow>
            ) : (
              fields.map((f) => <FieldRow key={f.id} field={f} />)
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

const DATA_TYPES = ['text', 'number', 'date', 'datetime', 'boolean', 'enum', 'jsonb'] as const;

function FieldRow({ field }: { field: FieldDefinition }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(field.label ?? '');
  const [dataType, setDataType] = useState(field.data_type);
  const [sortList, setSortList] = useState(field.sort_order_list);
  const [sortDetail, setSortDetail] = useState(field.sort_order_detail);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggleVisibility = (key: 'is_visible_list' | 'is_visible_detail', value: boolean) => {
    startTransition(async () => {
      const res = await updateField({ id: field.id, [key]: value });
      if (!res.ok) setError(res.error ?? '更新失敗');
      router.refresh();
    });
  };

  const onSave = () => {
    setError(null);
    startTransition(async () => {
      const res = await updateField({
        id: field.id,
        label: label || null,
        data_type: dataType,
        sort_order_list: sortList,
        sort_order_detail: sortDetail,
      });
      if (!res.ok) {
        setError(res.error ?? '保存失敗');
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };

  const onCancel = () => {
    setLabel(field.label ?? '');
    setDataType(field.data_type);
    setSortList(field.sort_order_list);
    setSortDetail(field.sort_order_detail);
    setError(null);
    setEditing(false);
  };

  const onDelete = () => {
    if (field.is_system) return;
    if (!window.confirm(`フィールド「${field.field_name}」を削除しますか?`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteField(field.id);
      if (!res.ok) {
        setError(res.error ?? '削除失敗');
        return;
      }
      router.refresh();
    });
  };

  if (!editing) {
    return (
      <TableRow className="sf-row-hover">
        <TableCell className="py-2 font-mono text-xs">{field.field_name}</TableCell>
        <TableCell className="py-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-left text-sm hover:text-primary hover:underline"
            title="クリックしてラベルを編集"
          >
            {field.label ?? field.field_name}
          </button>
          {field.csv_column_name && field.csv_column_name !== field.label && (
            <div className="text-[10px] text-muted-foreground">
              CSV: {field.csv_column_name}
            </div>
          )}
        </TableCell>
        <TableCell className="py-2 text-xs text-muted-foreground">{field.data_type}</TableCell>
        <TableCell className="py-2 text-center">
          <input
            type="checkbox"
            checked={field.is_visible_list}
            disabled={pending}
            onChange={(e) => toggleVisibility('is_visible_list', e.target.checked)}
            aria-label="一覧に表示"
          />
        </TableCell>
        <TableCell className="py-2 text-center">
          <input
            type="checkbox"
            checked={field.is_visible_detail}
            disabled={pending}
            onChange={(e) => toggleVisibility('is_visible_detail', e.target.checked)}
            aria-label="詳細に表示"
          />
        </TableCell>
        <TableCell className="py-2 text-right tabular-nums text-xs">
          {field.sort_order_list}
        </TableCell>
        <TableCell className="py-2 text-right tabular-nums text-xs">
          {field.sort_order_detail}
        </TableCell>
        <TableCell className="py-2 text-right">
          <div className="flex justify-end gap-1">
            <button
              type="button"
              aria-label="編集"
              onClick={() => setEditing(true)}
              className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="削除"
              onClick={onDelete}
              disabled={field.is_system || pending}
              className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30"
              title={field.is_system ? 'システム標準は削除できません' : '削除'}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          {error && <span className="text-[10px] text-destructive">{error}</span>}
        </TableCell>
      </TableRow>
    );
  }

  // 編集モード
  return (
    <TableRow className="bg-accent/30">
      <TableCell className="py-2 font-mono text-xs">{field.field_name}</TableCell>
      <TableCell className="py-2">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={field.field_name}
          maxLength={100}
          aria-label="ラベル"
        />
        {field.csv_column_name && (
          <div className="mt-1 text-[10px] text-muted-foreground">
            CSV: {field.csv_column_name}
          </div>
        )}
      </TableCell>
      <TableCell className="py-2">
        <Select
          value={dataType}
          onChange={(e) => setDataType(e.target.value as typeof dataType)}
          aria-label="データ型"
        >
          {DATA_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
      </TableCell>
      <TableCell className="py-2 text-center text-xs text-muted-foreground">―</TableCell>
      <TableCell className="py-2 text-center text-xs text-muted-foreground">―</TableCell>
      <TableCell className="py-2">
        <Input
          type="number"
          value={sortList}
          onChange={(e) => setSortList(Number.parseInt(e.target.value, 10) || 0)}
          className="w-20 text-right"
          aria-label="一覧並び順"
        />
      </TableCell>
      <TableCell className="py-2">
        <Input
          type="number"
          value={sortDetail}
          onChange={(e) => setSortDetail(Number.parseInt(e.target.value, 10) || 0)}
          className="w-20 text-right"
          aria-label="詳細並び順"
        />
      </TableCell>
      <TableCell className="py-2 text-right">
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-1">
            <Button size="sm" onClick={onSave} disabled={pending}>
              {pending ? '...' : '保存'}
            </Button>
            <button
              type="button"
              aria-label="キャンセル"
              onClick={onCancel}
              disabled={pending}
              className="grid h-7 w-7 place-items-center rounded border border-input text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {error && <span className="text-[10px] text-destructive">{error}</span>}
        </div>
      </TableCell>
    </TableRow>
  );
}
