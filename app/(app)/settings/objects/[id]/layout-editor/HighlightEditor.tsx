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
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, X, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { saveHighlightFields } from '@/lib/domain/object_metadata_actions';
import type { FieldDefinition } from '@/lib/domain/object_metadata';

/**
 * ハイライトパネル編集タブ (Phase 2.6)
 *
 * 会員詳細画面の上部ファクトバー (プロテクト / 電話番号 / …) に
 * どのフィールドを何番目に表示するかを管理者が設定できる。
 *
 * 左: 表示中フィールド (DnD で並び替え、× で非表示へ)
 * 右: 非表示フィールド (＋ で表示中へ)
 */
interface Props {
  objectId: string;
  allFields: FieldDefinition[];
}

export function HighlightEditor({ objectId, allFields }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saveMsg, setSaveMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // プレースホルダーは対象外
  const usable = useMemo(
    () => allFields.filter((f) => !f.is_placeholder),
    [allFields],
  );

  const initial = useMemo(
    () =>
      usable
        .filter((f) => f.is_visible_highlight)
        .sort((a, b) => a.sort_order_highlight - b.sort_order_highlight)
        .map((f) => f.id),
    [usable],
  );

  const [visibleIds, setVisibleIds] = useState<number[]>(initial);

  const fieldMap = useMemo(() => {
    const m = new Map<number, FieldDefinition>();
    for (const f of usable) m.set(f.id, f);
    return m;
  }, [usable]);

  const hiddenFields = useMemo(
    () => usable.filter((f) => !visibleIds.includes(f.id)),
    [usable, visibleIds],
  );

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
    const aIdx = visibleIds.indexOf(aId);
    const oIdx = visibleIds.indexOf(oId);
    if (aIdx < 0 || oIdx < 0) return;
    setVisibleIds(arrayMove(visibleIds, aIdx, oIdx));
  };

  const addField = (id: number) => {
    setVisibleIds((prev) => [...prev, id]);
  };

  const removeField = (id: number) => {
    setVisibleIds((prev) => prev.filter((x) => x !== id));
  };

  const onSave = () => {
    setSaveMsg(null);
    startTransition(async () => {
      const res = await saveHighlightFields(objectId, visibleIds);
      if (!res.ok) {
        setSaveMsg({ type: 'err', text: res.error ?? '保存失敗' });
        return;
      }
      setSaveMsg({ type: 'ok', text: res.message ?? '保存しました' });
      router.refresh();
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* 左: 表示中フィールド */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between border-b py-3">
          <div>
            <CardTitle className="text-sm">表示中のフィールド</CardTitle>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              ドラッグで並び替え / × で非表示に
            </p>
          </div>
          <Button size="sm" onClick={onSave} disabled={pending}>
            {pending ? '保存中…' : '保存'}
          </Button>
        </CardHeader>
        <CardContent className="p-3">
          {saveMsg && (
            <p
              role={saveMsg.type === 'err' ? 'alert' : 'status'}
              className={`mb-2 text-sm ${saveMsg.type === 'err' ? 'text-destructive' : 'text-green-700'}`}
            >
              {saveMsg.text}
            </p>
          )}

          {visibleIds.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              フィールドが選択されていません。右の一覧から追加してください。
            </p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext
                items={visibleIds.map((id) => `h-${id}`)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-1">
                  {visibleIds.map((fid, idx) => {
                    const f = fieldMap.get(fid);
                    if (!f) return null;
                    return (
                      <SortableHighlightItem
                        key={fid}
                        field={f}
                        index={idx + 1}
                        onRemove={() => removeField(fid)}
                      />
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {/* プレビュー */}
          {visibleIds.length > 0 && (
            <div className="mt-4 rounded border bg-gray-50 p-3">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                プレビュー
              </p>
              <div className="flex flex-wrap gap-x-8 gap-y-2">
                {visibleIds.map((fid) => {
                  const f = fieldMap.get(fid);
                  if (!f) return null;
                  return (
                    <div key={fid} className="min-w-[100px]">
                      <p className="text-[10px] text-muted-foreground">{f.label ?? f.field_name}</p>
                      <p className="text-sm text-foreground">(値)</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 右: 非表示フィールド */}
      <Card>
        <CardHeader className="border-b py-3">
          <CardTitle className="text-sm">非表示のフィールド</CardTitle>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            ＋ をクリックして表示中に追加
          </p>
        </CardHeader>
        <CardContent className="max-h-[480px] overflow-y-auto p-3">
          {hiddenFields.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              すべてのフィールドが表示中です
            </p>
          ) : (
            <div className="space-y-1">
              {hiddenFields.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between rounded border bg-card px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium">{f.label ?? f.field_name}</span>
                    {!f.is_in_db && (
                      <Badge variant="secondary" className="ml-2 text-[9px]">
                        extra
                      </Badge>
                    )}
                    <span className="ml-2 text-[10px] text-muted-foreground">{f.data_type}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => addField(f.id)}
                    aria-label={`${f.label ?? f.field_name} を追加`}
                    className="ml-2 grid h-6 w-6 shrink-0 place-items-center rounded border bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SortableHighlightItem({
  field,
  index,
  onRemove,
}: {
  field: FieldDefinition;
  index: number;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `h-${field.id}` });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      className="flex items-center gap-2 rounded border bg-card px-2 py-2"
    >
      <span
        className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </span>
      <span className="w-5 shrink-0 text-center text-[11px] text-muted-foreground">{index}</span>
      <div className="min-w-0 flex-1">
        <span className="text-sm font-medium">{field.label ?? field.field_name}</span>
        {!field.is_in_db && (
          <Badge variant="secondary" className="ml-2 text-[9px]">
            extra
          </Badge>
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`${field.label ?? field.field_name} を非表示にする`}
        className="grid h-5 w-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
