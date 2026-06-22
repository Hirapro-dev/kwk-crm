'use client';

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { reorderFields } from '@/lib/domain/object_metadata_actions';
import type { FieldDefinition } from '@/lib/domain/object_metadata';

/**
 * 一覧列レイアウトエディタ (Phase 2.5)
 *
 * 一覧表示ON (is_visible_list=true) のフィールドを横並びで表示し、
 * ヘッダーをドラッグして列順を変更する。
 *
 * 保存ボタンで sort_order_list を更新。
 */
interface Props {
  allFields: FieldDefinition[];
}

export function ListColumnEditor({ allFields }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saveMsg, setSaveMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const visibleFields = useMemo(
    () =>
      allFields
        .filter((f) => f.is_visible_list)
        .sort((a, b) => a.sort_order_list - b.sort_order_list),
    [allFields],
  );

  const [orderedIds, setOrderedIds] = useState<number[]>(visibleFields.map((f) => f.id));

  // フィールドID → FieldDefinition
  const fieldMap = useMemo(() => {
    const m = new Map<number, FieldDefinition>();
    for (const f of allFields) m.set(f.id, f);
    return m;
  }, [allFields]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const aId = Number.parseInt(String(active.id).slice(2), 10);
    const oId = Number.parseInt(String(over.id).slice(2), 10);
    const aIdx = orderedIds.indexOf(aId);
    const oIdx = orderedIds.indexOf(oId);
    if (aIdx < 0 || oIdx < 0) return;
    setOrderedIds(arrayMove(orderedIds, aIdx, oIdx));
  };

  const onSave = () => {
    setSaveMsg(null);
    const items = orderedIds.map((id, idx) => ({ id, sort_order: (idx + 1) * 10 }));
    startTransition(async () => {
      const res = await reorderFields('list', items);
      if (!res.ok) {
        setSaveMsg({ type: 'err', text: res.error ?? '保存失敗' });
        return;
      }
      setSaveMsg({ type: 'ok', text: res.message ?? '保存しました' });
      router.refresh();
    });
  };

  if (visibleFields.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          一覧に表示するフィールドが選択されていません。
          <br />
          オブジェクト管理画面で「一覧」表示を ON にしてください。
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between border-b py-3">
        <CardTitle className="text-sm">一覧列の並び替え</CardTitle>
        <Button size="sm" onClick={onSave} disabled={pending}>
          {pending ? '保存中…' : '保存'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        {saveMsg && (
          <p
            role={saveMsg.type === 'err' ? 'alert' : 'status'}
            className={
              saveMsg.type === 'err'
                ? 'text-sm text-destructive'
                : 'text-sm text-green-700'
            }
          >
            {saveMsg.text}
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          列ヘッダーを左右にドラッグして並び替えてください。
        </p>

        {/* 列ヘッダー DnD */}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <div className="overflow-x-auto">
            <SortableContext
              items={orderedIds.map((id) => `c-${id}`)}
              strategy={horizontalListSortingStrategy}
            >
              <div className="flex gap-1 rounded border bg-secondary/30 p-2">
                {orderedIds.map((fid) => {
                  const f = fieldMap.get(fid);
                  if (!f) return null;
                  return <SortableColumnHeader key={fid} field={f} />;
                })}
              </div>
            </SortableContext>
          </div>
        </DndContext>

        {/* プレビューテーブル(ヘッダーのみ、データなし) */}
        <div className="overflow-x-auto">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            プレビュー
          </p>
          <table className="w-full table-auto border-collapse text-sm">
            <thead>
              <tr className="bg-secondary/50">
                {orderedIds.map((fid) => {
                  const f = fieldMap.get(fid);
                  if (!f) return null;
                  return (
                    <th
                      key={fid}
                      className="whitespace-nowrap border-b border-r px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-muted-foreground"
                    >
                      {f.label ?? f.field_name}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              <tr>
                {orderedIds.map((fid) => (
                  <td
                    key={fid}
                    className="whitespace-nowrap border-r px-3 py-2 text-xs text-muted-foreground"
                  >
                    (サンプル値)
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function SortableColumnHeader({ field }: { field: FieldDefinition }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `c-${field.id}` });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className="flex shrink-0 cursor-grab touch-none items-center gap-1 rounded border bg-card px-2 py-1 text-xs shadow-sm active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <GripVertical className="h-3 w-3 text-muted-foreground" />
      <span className="font-medium">{field.label ?? field.field_name}</span>
      {!field.is_in_db && (
        <Badge variant="secondary" className="text-[9px]">
          extra
        </Badge>
      )}
    </div>
  );
}
