'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TableCell, TableRow } from '@/components/ui/table';
import { upsertAcquisitionPoint } from '@/lib/domain/master_actions';
import type { AcquisitionPointMaster } from '@/lib/domain/masters';
import { Pencil, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/** 顧客情報取得ポイントマスタの1行(閲覧 ↔ 編集) */
export function PointRow({ point }: { point: AcquisitionPointMaster }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(point.name);
  const [sortOrder, setSortOrder] = useState(String(point.sort_order));
  const [isActive, setIsActive] = useState(point.is_active);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onSave = () => {
    setError(null);
    startTransition(async () => {
      const res = await upsertAcquisitionPoint({
        id: point.id,
        name,
        sort_order: Number(sortOrder) || 0,
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
    setName(point.name);
    setSortOrder(String(point.sort_order));
    setIsActive(point.is_active);
    setError(null);
    setEditing(false);
  };

  if (!editing) {
    return (
      <TableRow className={point.is_active ? 'sf-row-hover' : 'sf-row-hover opacity-60'}>
        <TableCell className="py-2 text-xs tabular-nums text-muted-foreground">
          {point.sort_order}
        </TableCell>
        <TableCell className="py-2 text-sm font-medium">{point.name}</TableCell>
        <TableCell className="py-2 text-center">
          <input type="checkbox" checked={point.is_active} disabled aria-label="有効" />
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
  return (
    <TableRow className="bg-accent/30">
      <TableCell className="py-2">
        <Input
          type="number"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          className="w-20"
          aria-label="並び順"
        />
      </TableCell>
      <TableCell className="py-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          aria-label="名前"
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
