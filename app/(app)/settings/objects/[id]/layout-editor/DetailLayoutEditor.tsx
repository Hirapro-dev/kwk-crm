'use client';

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Pencil,
  Plus,
  Square,
  Trash2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  createPlaceholder,
  deletePlaceholder,
  reorderFields,
} from '@/lib/domain/object_metadata_actions';
import type { FieldDefinition } from '@/lib/domain/object_metadata';

/**
 * 詳細レイアウトエディタ (Phase 2.5)
 *
 * 機能:
 *   - 配置済みフィールドのセクション単位グルーピング
 *   - DnD でフィールドをセクション内/間で並び替え
 *   - セクションの ▲▼ ボタンで縦方向の並び替え
 *   - 「+ 空白を追加」ボタンで空のセル (is_placeholder=true) を挿入
 *
 * 保存:
 *   - reorderFields('detail', items) で sort_order_detail + section_name を更新
 *
 * Hydration 対策:
 *   - @dnd-kit は内部で生成する aria-describedby ID が SSR↔CSR で不一致になり
 *     Hydration エラーを起こすため、mounted フラグで CSR 側でのみ DnD を描画する。
 */

interface Props {
  objectId: string;
  allFields: FieldDefinition[];
}

interface Section {
  id: string;
  name: string;
  fieldIds: number[];
}

export function DetailLayoutEditor({ objectId, allFields }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saveMsg, setSaveMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Hydration 対策: クライアントマウント後にのみ DnD を有効化
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // 初期状態: is_visible_detail=true をセクション順に並べる
  const initialSections = useMemo<Section[]>(() => {
    const visible = allFields.filter((f) => f.is_visible_detail);
    const groups: Section[] = [];
    const sectionMap = new Map<string, Section>();

    for (const f of visible) {
      const name = f.section_name ?? '';
      let sec = sectionMap.get(name);
      if (!sec) {
        sec = { id: `sec-${sectionMap.size}`, name, fieldIds: [] };
        sectionMap.set(name, sec);
        groups.push(sec);
      }
      sec.fieldIds.push(f.id);
    }
    if (groups.length === 0) {
      groups.push({ id: 'sec-0', name: '基本情報', fieldIds: [] });
    }
    return groups;
  }, [allFields]);

  const [sections, setSections] = useState<Section[]>(initialSections);

  // 左ペイン: 利用可能フィールド (placeholder は除外)
  const availableFields = useMemo(() => {
    return allFields.filter((f) => !f.is_visible_detail && !f.is_placeholder);
  }, [allFields]);

  const fieldMap = useMemo(() => {
    const m = new Map<number, FieldDefinition>();
    for (const f of allFields) m.set(f.id, f);
    return m;
  }, [allFields]);

  // ----- DnD -----
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over) return;
    if (active.id === over.id) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    if (!activeId.startsWith('f-')) return;
    const activeFid = Number.parseInt(activeId.slice(2), 10);

    const fromSecIdx = sections.findIndex((s) => s.fieldIds.includes(activeFid));
    if (fromSecIdx < 0) return;

    let toSecIdx: number;
    let toIdx: number;

    if (overId.startsWith('f-')) {
      const overFid = Number.parseInt(overId.slice(2), 10);
      toSecIdx = sections.findIndex((s) => s.fieldIds.includes(overFid));
      if (toSecIdx < 0) return;
      toIdx = sections[toSecIdx]!.fieldIds.indexOf(overFid);
    } else if (overId.startsWith('sec-')) {
      toSecIdx = sections.findIndex((s) => s.id === overId);
      if (toSecIdx < 0) return;
      toIdx = sections[toSecIdx]!.fieldIds.length;
    } else {
      return;
    }

    const newSections = sections.map((s) => ({ ...s, fieldIds: [...s.fieldIds] }));
    newSections[fromSecIdx]!.fieldIds.splice(
      newSections[fromSecIdx]!.fieldIds.indexOf(activeFid),
      1,
    );
    if (fromSecIdx === toSecIdx && toIdx > newSections[toSecIdx]!.fieldIds.length) {
      toIdx = newSections[toSecIdx]!.fieldIds.length;
    }
    newSections[toSecIdx]!.fieldIds.splice(toIdx, 0, activeFid);
    setSections(newSections);
  };

  // ----- セクション操作 -----
  const addSection = () => {
    const newId = `sec-${Date.now()}`;
    setSections([...sections, { id: newId, name: '新しいセクション', fieldIds: [] }]);
  };

  const renameSection = (id: string, name: string) => {
    setSections(sections.map((s) => (s.id === id ? { ...s, name } : s)));
  };

  const moveSection = (id: string, dir: -1 | 1) => {
    const idx = sections.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= sections.length) return;
    const next = [...sections];
    // SWC は分割代入の左辺で non-null assertion (!) を許可しないため、
    // 一時変数を使った素朴な swap で実装する。
    const tmp = next[idx] as Section;
    next[idx] = next[target] as Section;
    next[target] = tmp;
    setSections(next);
  };

  const removeSection = (id: string) => {
    const sec = sections.find((s) => s.id === id);
    if (!sec) return;
    if (sec.fieldIds.length > 0) {
      if (
        !window.confirm(
          `セクション「${sec.name || '(未分類)'}」を削除します。中のフィールド ${sec.fieldIds.length} 件は「(未分類)」に移動します。続行しますか?`,
        )
      ) {
        return;
      }
      const unsorted = sections.find((s) => s.id !== id && s.name === '');
      if (!unsorted) {
        // 未分類が無ければ末尾に作る
        const filtered = sections.filter((s) => s.id !== id);
        filtered.push({ id: 'sec-unsorted', name: '', fieldIds: [...sec.fieldIds] });
        setSections(filtered);
        return;
      }
      setSections(
        sections
          .filter((s) => s.id !== id)
          .map((s) =>
            s.id === unsorted.id ? { ...s, fieldIds: [...s.fieldIds, ...sec.fieldIds] } : s,
          ),
      );
      return;
    }
    setSections(sections.filter((s) => s.id !== id));
  };

  // ----- 空白セル -----
  const addPlaceholder = (sectionId: string) => {
    const sec = sections.find((s) => s.id === sectionId);
    if (!sec) return;
    // sort_order_detail を計算 (とりあえず仮の値、保存時に再採番される)
    const tempOrder = (sec.fieldIds.length + 1) * 10;
    startTransition(async () => {
      const res = await createPlaceholder({
        object_id: objectId,
        section_name: sec.name || null,
        sort_order_detail: tempOrder,
      });
      if (!res.ok || !res.id) {
        setSaveMsg({ type: 'err', text: res.error ?? '空白追加に失敗' });
        return;
      }
      // ローカル state にも追加 (フルリロードを待たずに反映)
      setSections((prev) =>
        prev.map((s) =>
          s.id === sectionId ? { ...s, fieldIds: [...s.fieldIds, res.id!] } : s,
        ),
      );
      router.refresh();
    });
  };

  const removePlaceholder = (fieldId: number) => {
    startTransition(async () => {
      const res = await deletePlaceholder(fieldId);
      if (!res.ok) {
        setSaveMsg({ type: 'err', text: res.error ?? '削除失敗' });
        return;
      }
      setSections((prev) =>
        prev.map((s) => ({ ...s, fieldIds: s.fieldIds.filter((id) => id !== fieldId) })),
      );
      router.refresh();
    });
  };

  // ----- 保存 -----
  const onSave = () => {
    setSaveMsg(null);
    let order = 10;
    const items: { id: number; sort_order: number; section_name: string | null }[] = [];
    for (const sec of sections) {
      for (const fid of sec.fieldIds) {
        items.push({
          id: fid,
          sort_order: order,
          section_name: sec.name || null,
        });
        order += 10;
      }
    }

    startTransition(async () => {
      const res = await reorderFields('detail', items);
      if (!res.ok) {
        setSaveMsg({ type: 'err', text: res.error ?? '保存失敗' });
        return;
      }
      setSaveMsg({ type: 'ok', text: res.message ?? '保存しました' });
      router.refresh();
    });
  };

  // ----- レンダリング -----
  const layoutBody = (
    <div className="grid gap-3 lg:grid-cols-3">
      {/* 左ペイン */}
      <Card className="lg:col-span-1">
        <CardHeader className="border-b py-3">
          <CardTitle className="text-sm">
            利用可能フィールド ({availableFields.length}件)
          </CardTitle>
        </CardHeader>
        <CardContent className="max-h-[600px] overflow-y-auto p-2">
          {availableFields.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">
              すべてのフィールドが配置されています。
            </p>
          ) : (
            <ul className="space-y-1">
              {availableFields.map((f) => (
                <li
                  key={f.id}
                  className="rounded border border-dashed p-2 text-xs text-muted-foreground"
                >
                  <div className="font-medium text-foreground">
                    {f.label ?? f.field_name}
                  </div>
                  <div className="font-mono text-[10px]">{f.field_name}</div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 rounded bg-gray-50 p-2 text-[10px] text-muted-foreground">
            💡 ここに表示されるのは「詳細表示OFF」のフィールドです。
            <br />
            配置するにはオブジェクト管理画面で「詳細」をONにしてください。
          </p>
        </CardContent>
      </Card>

      {/* 右ペイン */}
      <div className="space-y-3 lg:col-span-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between border-b py-3">
            <CardTitle className="text-sm">レイアウト (プレビュー)</CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={addSection}>
                <Plus className="h-3.5 w-3.5" /> セクション追加
              </Button>
              <Button size="sm" onClick={onSave} disabled={pending}>
                {pending ? '保存中…' : '保存'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
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

            {sections.map((sec, secIdx) => (
              <SectionPanel
                key={sec.id}
                section={sec}
                fieldMap={fieldMap}
                isFirst={secIdx === 0}
                isLast={secIdx === sections.length - 1}
                onRename={(name) => renameSection(sec.id, name)}
                onRemove={() => removeSection(sec.id)}
                onMoveUp={() => moveSection(sec.id, -1)}
                onMoveDown={() => moveSection(sec.id, 1)}
                onAddPlaceholder={() => addPlaceholder(sec.id)}
                onRemovePlaceholder={(fid) => removePlaceholder(fid)}
              />
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );

  // SSR 時は DnD を有効にしない (Hydration 不一致回避)
  if (!mounted) {
    return layoutBody;
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      {layoutBody}
    </DndContext>
  );
}

// ----------------------------------------------------------------------------
// セクションパネル
// ----------------------------------------------------------------------------
function SectionPanel({
  section,
  fieldMap,
  isFirst,
  isLast,
  onRename,
  onRemove,
  onMoveUp,
  onMoveDown,
  onAddPlaceholder,
  onRemovePlaceholder,
}: {
  section: Section;
  fieldMap: Map<number, FieldDefinition>;
  isFirst: boolean;
  isLast: boolean;
  onRename: (name: string) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onAddPlaceholder: () => void;
  onRemovePlaceholder: (fieldId: number) => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(section.name);

  const { setNodeRef, isOver } = useDroppable({ id: section.id });

  const handleRename = () => {
    if (name !== section.name) onRename(name);
    setEditingName(false);
  };

  return (
    <div className="rounded border bg-card">
      <div className="flex items-center justify-between border-b border-slate-300 bg-slate-100 px-3 py-2">
        {editingName ? (
          <div className="flex flex-1 items-center gap-1">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              onBlur={handleRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename();
                if (e.key === 'Escape') {
                  setName(section.name);
                  setEditingName(false);
                }
              }}
              className="w-60"
              maxLength={100}
            />
          </div>
        ) : (
          <div className="flex flex-1 items-center gap-2">
            <h4 className="text-sm font-bold text-foreground">
              {section.name || '(未分類)'}
            </h4>
            <button
              type="button"
              aria-label="セクション名を編集"
              onClick={() => setEditingName(true)}
              className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <span className="text-[10px] text-muted-foreground">
              {section.fieldIds.length} フィールド
            </span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="セクションを上に移動"
            onClick={onMoveUp}
            disabled={isFirst}
            className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="セクションを下に移動"
            onClick={onMoveDown}
            disabled={isLast}
            className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="空白を追加"
            title="空白セルを追加"
            onClick={onAddPlaceholder}
            className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Square className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="セクション削除"
            onClick={onRemove}
            className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div
        ref={setNodeRef}
        className={`min-h-[60px] p-2 ${isOver ? 'bg-primary/5' : ''}`}
      >
        <SortableContext
          items={section.fieldIds.map((id) => `f-${id}`)}
          strategy={verticalListSortingStrategy}
        >
          {section.fieldIds.length === 0 ? (
            <p className="p-2 text-center text-xs text-muted-foreground">
              ここにフィールドをドロップ
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {section.fieldIds.map((fid) => {
                const f = fieldMap.get(fid);
                if (!f) return null;
                if (f.is_placeholder) {
                  return (
                    <SortablePlaceholderItem
                      key={fid}
                      fieldId={fid}
                      onRemove={() => onRemovePlaceholder(fid)}
                    />
                  );
                }
                return <SortableFieldItem key={fid} field={f} />;
              })}
            </div>
          )}
        </SortableContext>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// ドラッグ可能なフィールド項目
// ----------------------------------------------------------------------------
function SortableFieldItem({ field }: { field: FieldDefinition }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `f-${field.id}` });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className="flex items-center gap-2 rounded border bg-card p-2 text-sm shadow-sm"
    >
      <button
        type="button"
        aria-label="ドラッグ"
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="flex-1">
        <div className="font-medium text-foreground">
          {field.label ?? field.field_name}
        </div>
        <div className="font-mono text-[10px] text-muted-foreground">
          {field.field_name}
          {!field.is_in_db && (
            <Badge variant="secondary" className="ml-1 text-[9px]">
              extra
            </Badge>
          )}
        </div>
      </div>
      <span className="text-[10px] text-muted-foreground">{field.data_type}</span>
    </div>
  );
}

// ----------------------------------------------------------------------------
// 空白セル (placeholder) 用のドラッグ項目
// ----------------------------------------------------------------------------
function SortablePlaceholderItem({
  fieldId,
  onRemove,
}: {
  fieldId: number;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `f-${fieldId}` });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className="flex items-center gap-2 rounded border border-dashed bg-gray-50 p-2 text-sm"
    >
      <button
        type="button"
        aria-label="ドラッグ"
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="flex-1 text-xs italic text-muted-foreground">(空白)</div>
      <button
        type="button"
        aria-label="空白を削除"
        onClick={onRemove}
        className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}
