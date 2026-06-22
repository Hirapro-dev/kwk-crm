'use client';

/**
 * メニューバー設定エディタ (CLAUDE.md §5.10b)
 *
 * - 縦方向ドラッグで並び替え(@dnd-kit)
 * - 各項目の表示ON/OFF トグル
 * - 「保存」で saveNavOrder により sort_order / is_visible を一括保存
 */

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
import { Eye, EyeOff, GripVertical } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { saveNavOrder } from '@/lib/domain/nav_actions';
import type { NavItem } from '@/lib/domain/nav_items';
import { cn } from '@/lib/utils/cn';

interface Props {
  items: NavItem[];
}

interface EditState {
  id: string;
  label: string;
  href: string;
  is_visible: boolean;
}

export function NavEditor({ items }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saveMsg, setSaveMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [rows, setRows] = useState<EditState[]>(
    items.map((n) => ({
      id: n.id,
      label: n.label,
      href: n.href,
      is_visible: n.is_visible,
    })),
  );

  const byId = useMemo(() => {
    const m = new Map<string, EditState>();
    for (const r of rows) m.set(r.id, r);
    return m;
  }, [rows]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const aIdx = rows.findIndex((r) => `n-${r.id}` === active.id);
    const oIdx = rows.findIndex((r) => `n-${r.id}` === over.id);
    if (aIdx < 0 || oIdx < 0) return;
    setRows(arrayMove(rows, aIdx, oIdx));
  };

  const toggleVisible = (id: string) =>
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, is_visible: !r.is_visible } : r)),
    );

  const onSave = () => {
    setSaveMsg(null);
    const payload = rows.map((r, idx) => ({
      id: r.id,
      sort_order: (idx + 1) * 10,
      is_visible: r.is_visible,
    }));
    startTransition(async () => {
      const res = await saveNavOrder(payload);
      if (!res.ok) {
        setSaveMsg({ type: 'err', text: res.error ?? '保存に失敗しました' });
        return;
      }
      setSaveMsg({ type: 'ok', text: res.message ?? '保存しました' });
      router.refresh();
    });
  };

  return (
    <Card className="max-w-xl">
      <CardHeader className="flex flex-row items-center justify-between border-b py-3">
        <CardTitle className="text-sm">メニューの並び順・表示</CardTitle>
        <Button size="sm" onClick={onSave} disabled={pending}>
          {pending ? '保存中…' : '保存'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        {saveMsg && (
          <p
            role={saveMsg.type === 'err' ? 'alert' : 'status'}
            className={cn(
              'text-sm',
              saveMsg.type === 'err' ? 'text-destructive' : 'text-green-700',
            )}
          >
            {saveMsg.text}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          行をドラッグして並び替え、目のアイコンで表示/非表示を切り替えます。保存後にメニューへ反映されます。
        </p>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext
            items={rows.map((r) => `n-${r.id}`)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="space-y-1">
              {rows.map((r, idx) => (
                <SortableNavRow
                  key={r.id}
                  row={byId.get(r.id) ?? r}
                  position={idx + 1}
                  onToggle={() => toggleVisible(r.id)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      </CardContent>
    </Card>
  );
}

function SortableNavRow({
  row,
  position,
  onToggle,
}: {
  row: EditState;
  position: number;
  onToggle: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `n-${row.id}` });

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className={cn(
        'flex items-center gap-2 rounded border bg-card px-2 py-2 shadow-sm',
        !row.is_visible && 'opacity-60',
      )}
    >
      {/* ドラッグハンドル */}
      <button
        type="button"
        className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
        aria-label="ドラッグして並び替え"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <span className="w-5 text-center text-xs text-muted-foreground tabular-nums">
        {position}
      </span>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{row.label}</div>
        <div className="truncate font-mono text-[10px] text-muted-foreground">
          {row.href}
        </div>
      </div>

      {/* 表示/非表示トグル */}
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={row.is_visible}
        title={row.is_visible ? '表示中(クリックで非表示)' : '非表示(クリックで表示)'}
        className={cn(
          'flex items-center gap-1 rounded border px-2 py-1 text-xs transition-colors',
          row.is_visible
            ? 'border-primary/30 text-primary hover:bg-primary/5'
            : 'text-muted-foreground hover:bg-accent',
        )}
      >
        {row.is_visible ? (
          <>
            <Eye className="h-3.5 w-3.5" /> 表示
          </>
        ) : (
          <>
            <EyeOff className="h-3.5 w-3.5" /> 非表示
          </>
        )}
      </button>
    </li>
  );
}
