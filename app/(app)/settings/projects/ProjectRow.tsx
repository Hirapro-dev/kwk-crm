'use client';

import { Pencil, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TableCell, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { upsertProject } from '@/lib/domain/project_actions';
import type { Project } from '@/lib/domain/projects_constants';

/**
 * 案件マスタの1行 (閲覧 ↔ 編集の切替を内部で持つ)。
 *
 * - 鉛筆アイコンクリックで編集モード
 * - 案件IDは編集不可 (表示のみ)
 * - 案件名 / 説明 / 有効を編集可
 * - 「保存」または「キャンセル」で閲覧モードに戻る
 */
export function ProjectRow({ project }: { project: Project }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [isActive, setIsActive] = useState(project.is_active);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onSave = () => {
    setError(null);
    startTransition(async () => {
      const res = await upsertProject({
        id: project.id,
        name,
        description: description || undefined,
        is_active: isActive,
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
    setName(project.name);
    setDescription(project.description ?? '');
    setIsActive(project.is_active);
    setError(null);
    setEditing(false);
  };

  if (!editing) {
    return (
      <TableRow className="sf-row-hover">
        <TableCell className="py-2 font-mono text-xs">{project.id}</TableCell>
        <TableCell className="py-2 font-medium">{project.name}</TableCell>
        <TableCell className="py-2 text-sm text-muted-foreground">
          {project.description ?? '-'}
        </TableCell>
        <TableCell className="py-2 text-center">
          <input
            type="checkbox"
            checked={project.is_active}
            disabled
            aria-label="有効"
          />
        </TableCell>
        <TableCell className="py-2 text-right">
          <button
            type="button"
            aria-label="編集"
            onClick={() => setEditing(true)}
            className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </TableCell>
      </TableRow>
    );
  }

  // 編集モード
  return (
    <TableRow className="bg-accent/30">
      <TableCell className="py-2 font-mono text-xs">{project.id}</TableCell>
      <TableCell className="py-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          required
          aria-label="案件名"
        />
      </TableCell>
      <TableCell className="py-2">
        <Textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-label="説明"
        />
      </TableCell>
      <TableCell className="py-2 text-center">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          aria-label="有効"
        />
      </TableCell>
      <TableCell className="py-2 text-right">
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-1">
            <Button size="sm" onClick={onSave} disabled={pending || !name.trim()}>
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
          {error && <span className="text-[11px] text-destructive">{error}</span>}
        </div>
      </TableCell>
    </TableRow>
  );
}
